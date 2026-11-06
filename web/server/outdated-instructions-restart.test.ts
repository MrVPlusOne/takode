import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OUTDATED_RESTART_SETTLE_MS,
  OutdatedInstructionsRestarts,
  type OutdatedRestartSessionView,
} from "./outdated-instructions-restart.js";

// A process a node kept running across a server restart, with instructions the
// new server would not build, is taken over and its session restarted only
// once it is idle, so no turn, permission request or waiting input is cut off.
describe("OutdatedInstructionsRestarts", () => {
  const coordinatorStartedAt = 1_000_000;
  let session: OutdatedRestartSessionView;
  let outdated: boolean;
  let stop: ReturnType<typeof vi.fn<(sessionId: string) => Promise<unknown>>>;
  let restarts: OutdatedInstructionsRestarts;
  /** Watchers of each session's turn and permission changes; calling one reports a change. */
  let watchers: Map<string, () => void>;
  /** Report a change in the session's turn or permission state, as a bridge event would. */
  const changed = (sessionId: string) => watchers.get(sessionId)?.();

  beforeEach(() => {
    vi.useFakeTimers({ now: coordinatorStartedAt });
    session = {
      isGenerating: false,
      pendingPermissions: new Map(),
      messageHistory: [{ type: "user_message", timestamp: coordinatorStartedAt - 5_000 }, { type: "result" }],
      pendingMessages: [],
      pendingCodexInputs: [],
      pendingCodexTurns: [],
    };
    outdated = true;
    stop = vi.fn(async () => true);
    watchers = new Map();
    restarts = new OutdatedInstructionsRestarts({
      runsOutdatedInstructions: () => outdated,
      bridgeSession: () => session,
      coordinatorStartedAt,
      watch: (sessionId, onChange) => {
        watchers.set(sessionId, onChange);
        return () => watchers.delete(sessionId);
      },
      stop,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // A session just taken over can look idle before it resumes its turn, so an
  // idle one is restarted only after the settle time.
  it("restarts an idle session once the takeover has settled", () => {
    restarts.tookOver("s-1");
    changed("s-1");
    expect(stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith("s-1");

    // Once restarted, the session is no longer watched.
    expect(watchers.has("s-1")).toBe(false);
  });

  it("waits for a running turn to end", () => {
    session.isGenerating = true;
    restarts.tookOver("s-1");
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).not.toHaveBeenCalled();

    session.isGenerating = false;
    changed("s-1");
    expect(stop).toHaveBeenCalledWith("s-1");
  });

  it("waits for open permission requests and waiting input", () => {
    session.pendingPermissions = new Map([["r-1", {}]]);
    restarts.tookOver("s-1");
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    session.pendingPermissions = new Map();
    session.pendingMessages = ["queued"];
    changed("s-1");
    session.pendingMessages = [];
    session.pendingCodexTurns = [{ status: "dispatched" }];
    changed("s-1");
    expect(stop).not.toHaveBeenCalled();

    session.pendingCodexTurns = [{ status: "completed" }];
    changed("s-1");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  // Turn state of a taken-over process may not be restored yet; a turn its
  // history shows opened before this server started and never finished counts as running.
  it("waits for a turn opened before the restart to finish", () => {
    session.messageHistory = [{ type: "user_message", timestamp: coordinatorStartedAt - 5_000 }];
    restarts.tookOver("s-1");
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).not.toHaveBeenCalled();

    session.messageHistory = [...session.messageHistory, { type: "result" }];
    changed("s-1");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  // Stopped or relaunched meanwhile (a node update, the user), the session already runs new instructions.
  it("leaves a session alone once it no longer runs the outdated process", () => {
    restarts.tookOver("s-1");
    outdated = false;
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).not.toHaveBeenCalled();
    expect(watchers.has("s-1")).toBe(false);
  });
});
