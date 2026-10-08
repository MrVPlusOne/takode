import type { RemoteProcess } from "./host-link-manager.js";

/**
 * Keep track of the permission requests (`can_use_tool` control requests) a
 * Claude process running under a node is still waiting to have answered, as
 * the raw stdout lines that asked them. `onChange` receives the current list
 * whenever it changes, so the session can save it for the next coordinator.
 *
 * A coordinator that takes such a process over after a restart replays the
 * saved lines into its stdout with {@link replayOpenClaudeRequests}, and the
 * Agent SDK asks them again. Claude Code does not resend them itself: its
 * answer to a second `initialize` no longer lists pending requests (checked
 * with 2.1.289).
 */
export function trackOpenClaudeRequests(
  proc: RemoteProcess,
  initial: readonly string[],
  onChange: (open: string[]) => void,
): void {
  const open = new Map<string, string>();
  for (const line of initial) {
    const id = requestIdOf(line, "control_request");
    if (id) open.set(id, line);
  }
  const changed = () => onChange([...open.values()]);
  eachLine(proc, "output", (line) => {
    const asked = requestIdOf(line, "control_request");
    if (asked) {
      open.set(asked, line);
      changed();
      return;
    }
    const cancelled = requestIdOf(line, "control_cancel_request");
    if (cancelled && open.delete(cancelled)) changed();
  });
  eachLine(proc, "input", (line) => {
    const answered = requestIdOf(line, "control_response");
    if (answered && open.delete(answered)) changed();
  });
}

/** Deliver saved permission requests to whoever reads the process's stdout, as if Claude had just asked them. */
export function replayOpenClaudeRequests(proc: RemoteProcess, lines: readonly string[]): void {
  for (const line of lines) proc.stdout.write(`${line}\n`);
}

/** The request id of a permission request, its cancellation or its answer; null for any other line. */
function requestIdOf(
  line: string,
  type: "control_request" | "control_cancel_request" | "control_response",
): string | null {
  if (!line.includes(type)) return null;
  try {
    const message = JSON.parse(line) as {
      type?: string;
      request_id?: string;
      request?: { subtype?: string };
      response?: { request_id?: string };
    };
    if (message.type !== type) return null;
    if (type === "control_request")
      return message.request?.subtype === "can_use_tool" ? (message.request_id ?? null) : null;
    if (type === "control_response") return message.response?.request_id ?? null;
    return message.request_id ?? null;
  } catch {
    return null;
  }
}

function eachLine(proc: RemoteProcess, event: "input" | "output", handle: (line: string) => void): void {
  let partial = "";
  proc.on(event, (data: Buffer) => {
    const lines = (partial + data.toString("utf-8")).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) handle(line);
  });
}
