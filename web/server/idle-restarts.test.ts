import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleRestarts, OUTDATED_RESTART_SETTLE_MS, type IdleRestartSessionView } from "./idle-restarts.js";

// A process a node kept running across a server restart, with instructions the
// new server would not build, is taken over and its session restarted only
// once it is idle, so no turn, permission request or waiting input is cut off.
describe("IdleRestarts", () => {
  const coordinatorStartedAt = 1_000_000;
  let session: IdleRestartSessionView;
  let outdated: boolean;
  let stop: ReturnType<typeof vi.fn<(sessionId: string) => Promise<unknown>>>;
  let restarts: IdleRestarts;
  /** Watchers of each session's turn and permission changes; calling one reports a change. */
  let watchers: Map<string, () => void>;
  /** Report a change in the session's turn or permission state, as a bridge event would. */
  const changed = (sessionId: string) => watchers.get(sessionId)?.();
  /** A process with outdated instructions was taken over, as the server reports it. */
  const tookOver = (sessionId: string) =>
    restarts.restartWhenIdle(sessionId, {
      reason: "to apply its new instructions",
      stillNeeded: () => outdated,
      settleMs: OUTDATED_RESTART_SETTLE_MS,
    });

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
    restarts = new IdleRestarts({
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
    tookOver("s-1");
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
    tookOver("s-1");
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).not.toHaveBeenCalled();

    session.isGenerating = false;
    changed("s-1");
    expect(stop).toHaveBeenCalledWith("s-1");
  });

  it("waits for open permission requests and waiting input", () => {
    session.pendingPermissions = new Map([["r-1", {}]]);
    tookOver("s-1");
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
    tookOver("s-1");
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).not.toHaveBeenCalled();

    session.messageHistory = [...session.messageHistory, { type: "result" }];
    changed("s-1");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  // Stopped or relaunched meanwhile (a node update, the user), the session already runs new instructions.
  it("leaves a session alone once it no longer runs the outdated process", () => {
    tookOver("s-1");
    outdated = false;
    vi.advanceTimersByTime(OUTDATED_RESTART_SETTLE_MS);
    expect(stop).not.toHaveBeenCalled();
    expect(watchers.has("s-1")).toBe(false);
  });

  // A refused model switch needs no settle time: an idle session restarts right
  // away, a busy one as soon as its turn ends.
  it("restarts an idle session at once when no settle time is asked for", () => {
    restarts.restartWhenIdle("s-1", { reason: "to switch models", stillNeeded: () => true });
    expect(stop).toHaveBeenCalledWith("s-1");
    expect(watchers.has("s-1")).toBe(false);

    session.isGenerating = true;
    restarts.restartWhenIdle("s-2", { reason: "to switch models", stillNeeded: () => true });
    expect(stop).toHaveBeenCalledTimes(1);
    session.isGenerating = false;
    changed("s-2");
    expect(stop).toHaveBeenLastCalledWith("s-2");
  });

  // A newer request for the same session replaces the older one, so only its condition counts.
  it("replaces an earlier request for the same session", () => {
    session.isGenerating = true;
    let needed = true;
    restarts.restartWhenIdle("s-1", { reason: "first", stillNeeded: () => true });
    restarts.restartWhenIdle("s-1", { reason: "second", stillNeeded: () => needed });
    needed = false;
    session.isGenerating = false;
    changed("s-1");
    expect(stop).not.toHaveBeenCalled();
    expect(watchers.has("s-1")).toBe(false);
  });
});
