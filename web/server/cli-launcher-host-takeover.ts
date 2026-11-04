/**
 * Taking over a session's process that outlived the previous coordinator on a node.
 *
 * Right after a restart the coordinator also updates its nodes to the new build, which
 * restarts them and ends their processes. A takeover still preparing then holds a process
 * that has already exited. Handed to the Agent SDK (or the Codex adapter), it would leave
 * the session waiting on it forever, every message going nowhere, so such a takeover
 * starts the process afresh instead, which resumes the conversation.
 */
import type { RemoteProcess, RemoteSpawnOptions } from "./remote-host/host-link-manager.js";
import { replayOpenClaudeRequests, trackOpenClaudeRequests } from "./remote-host/claude-open-requests.js";
import type { SdkSessionInfo } from "./session-info.js";
import { sessionTag } from "./session-tag.js";

/** The process to take over, or undefined (with a log line) when it has ended meanwhile. */
export function liveTakeover(sessionId: string, proc: RemoteProcess | undefined): RemoteProcess | undefined {
  if (!proc?.hasExited) return proc;
  console.log(
    `[cli-launcher] The host process of session ${sessionTag(sessionId)} ended before it was taken over; starting it afresh`,
  );
  return undefined;
}

/**
 * Process spawner for a node, in the shape the Agent SDK's custom spawn hook expects. It
 * hands over `adopted` while it still runs (checked when the SDK asks, which can be well
 * after the takeover began), and otherwise starts a process with `start`.
 */
export function claudeNodeSpawner(
  info: SdkSessionInfo,
  adopted: RemoteProcess | undefined,
  deps: { start: (options: RemoteSpawnOptions) => RemoteProcess; persist: () => void },
): (options: RemoteSpawnOptions) => RemoteProcess {
  return (options) => {
    const taken = liveTakeover(info.sessionId, adopted);
    const proc = taken ?? deps.start(options);
    const unanswered = taken ? (info.hostClaudeRequests ?? []) : [];
    // Saved so a coordinator that restarts while this process keeps running can ask them again.
    trackOpenClaudeRequests(proc, unanswered, (open) => {
      info.hostClaudeRequests = open;
      deps.persist();
    });
    if (!taken) return proc;
    options.signal?.addEventListener("abort", () => taken.kill("SIGTERM"), { once: true });
    queueMicrotask(() => {
      // It started long ago; the SDK still waits for the event.
      taken.emit("spawn");
      replayOpenClaudeRequests(taken, unanswered);
    });
    return taken;
  };
}
