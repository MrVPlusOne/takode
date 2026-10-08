import { RemoteProcess } from "./host-link-manager.js";
import { replayOpenClaudeRequests, trackOpenClaudeRequests } from "./claude-open-requests.js";

/** A Claude permission request as the CLI writes it to stdout. */
function permissionRequest(id: string): string {
  return JSON.stringify({
    type: "control_request",
    request_id: id,
    request: { subtype: "can_use_tool", tool_name: "Write" },
  });
}

/** Feed `text` to the process as host output, as the link does. */
function output(proc: RemoteProcess, text: string): void {
  proc.apply({ kind: "stdout", data: Buffer.from(text).toString("base64") });
}

// A Claude process under a node keeps waiting on its permission requests across
// a coordinator restart, and Claude does not ask them again. The launcher saves
// the open ones as they come and go, and the next coordinator replays them.
describe("open Claude permission requests", () => {
  it("tracks requests until they are answered or cancelled, across split lines", () => {
    const proc = new RemoteProcess("p-1", () => {});
    const saved: string[][] = [];
    trackOpenClaudeRequests(proc, [], (open) => saved.push(open));

    const first = permissionRequest("r-1");
    output(proc, `${JSON.stringify({ type: "assistant" })}\n${first.slice(0, 20)}`);
    output(proc, `${first.slice(20)}\n${permissionRequest("r-2")}\n`);
    // Other control requests are not permission prompts.
    output(
      proc,
      `${JSON.stringify({ type: "control_request", request_id: "x", request: { subtype: "hook_callback" } })}\n`,
    );
    expect(saved.at(-1)).toEqual([first, permissionRequest("r-2")]);

    proc.stdin.write(
      `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "r-1" } })}\n`,
    );
    output(proc, `${JSON.stringify({ type: "control_cancel_request", request_id: "r-2" })}\n`);
    expect(saved.at(-1)).toEqual([]);
  });

  it("replays saved requests to the new reader and still tracks their answers", async () => {
    const proc = new RemoteProcess("p-1", () => {});
    const saved: string[][] = [];
    const open = [permissionRequest("r-1")];
    trackOpenClaudeRequests(proc, open, (requests) => saved.push(requests));

    const read = new Promise<string>((resolve) => proc.stdout.once("data", (chunk: Buffer) => resolve(String(chunk))));
    replayOpenClaudeRequests(proc, open);
    expect(await read).toBe(`${open[0]}\n`);

    proc.stdin.write(
      `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "r-1" } })}\n`,
    );
    expect(saved.at(-1)).toEqual([]);
  });
});
