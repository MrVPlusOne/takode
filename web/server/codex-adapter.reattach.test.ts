import { describe, it, expect } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";
import type { JsonRpcRequest } from "./codex-jsonrpc-transport.js";
import type { BrowserIncomingMessage } from "./session-types.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

/** A stand-in Codex app-server process whose stdin lines can be inspected and stdout fed. */
function createMockProcess() {
  const written: string[] = [];
  let push: (line: string) => void = () => {};
  const proc = {
    stdin: {
      getWriter: () => ({
        write: async (chunk: Uint8Array) => void written.push(new TextDecoder().decode(chunk)),
        releaseLock: () => {},
      }),
    },
    stdout: new ReadableStream<Uint8Array>({
      start: (controller) => {
        push = (line) => controller.enqueue(new TextEncoder().encode(`${line}\n`));
      },
    }),
    stderr: new ReadableStream<Uint8Array>(),
    pid: undefined,
    exited: new Promise<number>(() => {}),
    kill: () => {},
  };
  const messages = () =>
    written
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id?: number; method?: string; result?: unknown });
  /** Wait for the adapter's next request with `method` and answer it. */
  const answer = async (method: string, reply: { result?: unknown; error?: { code: number; message: string } }) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const request = messages().find((message) => message.method === method && message.id !== undefined);
      if (request) {
        push(JSON.stringify({ id: request.id, ...reply }));
        await tick();
        return request;
      }
      await tick();
    }
    throw new Error(`The adapter never sent ${method}`);
  };
  return { proc, messages, answer, push };
}

describe("CodexAdapter reattaching to a running app-server", () => {
  // After a coordinator restart, a host's app-server is still initialized and
  // has the thread loaded mid-turn. The adapter accepts "Already initialized",
  // joins the loaded thread, keeps its request ids clear of the old client's,
  // and asks again the approval Codex is still waiting for (once, although Codex
  // resends it too), answering it under the original JSON-RPC id. The waiting
  // set is reported for saving throughout.
  it("joins the loaded thread and answers the request the previous coordinator left open", async () => {
    const mock = createMockProcess();
    const open: JsonRpcRequest = {
      id: 41,
      method: "item/commandExecution/requestApproval",
      params: { itemId: "item-1", command: "make deploy", cwd: "/srv" },
    };
    const saved: JsonRpcRequest[][] = [];
    const browser: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(mock.proc as never, "s-1", {
      cwd: "/srv",
      threadId: "thr_live",
      reattach: true,
      unansweredServerRequests: [open],
      onUnansweredServerRequestsChange: (requests) => saved.push(requests),
    });
    adapter.onBrowserMessage((message) => browser.push(message));
    expect(adapter.reattached).toBe(true);

    const initialize = await mock.answer("initialize", { error: { code: -32600, message: "Already initialized" } });
    expect(initialize.id).toBeGreaterThan(1_000_000);
    await mock.answer("thread/resume", {
      result: {
        thread: { id: "thr_live", status: { type: "active" }, turns: [{ id: "turn-9", status: "inProgress" }] },
      },
    });
    for (let attempt = 0; attempt < 200 && !browser.some((m) => m.type === "permission_request"); attempt++)
      await tick();

    expect(mock.messages().some((message) => message.method === "initialized")).toBe(false);
    expect(mock.messages().some((message) => message.method === "thread/start")).toBe(false);
    expect(adapter.getCurrentTurnId()).toBe("turn-9");
    const permission = browser.find((message) => message.type === "permission_request");
    if (permission?.type !== "permission_request") throw new Error("No permission request");
    expect(permission.request.input).toMatchObject({ command: "make deploy" });
    expect(saved.at(-1)).toEqual([open]);
    // The app-server also resends its open request on `thread/resume`; the user is asked once.
    mock.push(JSON.stringify(open));
    for (let attempt = 0; attempt < 20; attempt++) await tick();
    expect(browser.filter((message) => message.type === "permission_request")).toHaveLength(1);

    adapter.sendBrowserMessage({
      type: "permission_response",
      request_id: permission.request.request_id,
      behavior: "allow",
    });
    for (let attempt = 0; attempt < 200 && !mock.messages().some((m) => m.id === 41); attempt++) await tick();
    expect(mock.messages().find((message) => message.id === 41)?.result).toEqual({ decision: "accept" });
    expect(saved.at(-1)).toEqual([]);
  });

  // A thread with no turns yet has no rollout, so Codex cannot resume it, but the
  // reattached app-server still has it loaded: keep using it instead of starting a new one.
  it("keeps the loaded thread when it has no rollout to resume yet", async () => {
    const mock = createMockProcess();
    const meta: Array<{ cliSessionId?: string }> = [];
    const adapter = new CodexAdapter(mock.proc as never, "s-1", { cwd: "/srv", threadId: "thr_new", reattach: true });
    adapter.onSessionMeta((value) => meta.push(value));
    await mock.answer("initialize", { error: { code: -32600, message: "Already initialized" } });
    await mock.answer("thread/resume", { error: { code: -32600, message: "no rollout found for thread id thr_new" } });
    for (let attempt = 0; attempt < 200 && meta.length === 0; attempt++) await tick();

    expect(meta[0]?.cliSessionId).toBe("thr_new");
    expect(mock.messages().some((message) => message.method === "thread/start")).toBe(false);
  });
});
