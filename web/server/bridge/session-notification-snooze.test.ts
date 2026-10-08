import { describe, expect, it, vi } from "vitest";
import {
  buildPersistedSessionPayload,
  getNotificationStatusSnapshot,
  markNotificationDone,
  restorePersistedSessions,
  setNotificationMuted,
  snoozeNotification,
  wakeDueSnoozedNotifications,
} from "./session-registry-controller.js";

// "Remind me later" for needs-input prompts: a snooze is a timed mute that the server lifts on its own,
// at which point the prompt alerts again as if it were new. Snoozing is never an answer.

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    state: { backend_type: "claude" },
    pendingPermissions: new Map(),
    messageHistory: [],
    pendingMessages: [],
    eventBuffer: [],
    nextEventSeq: 1,
    lastAckSeq: 0,
    processedClientMessageIds: [],
    toolResults: new Map(),
    board: new Map(),
    completedBoard: new Map(),
    notifications: [
      { id: "n-1", category: "needs-input", summary: "Pick a plan", timestamp: 1000, messageId: null, done: false },
    ],
    attentionRecords: [],
    notificationCounter: 1,
    taskHistory: [],
    keywords: [],
    lastReadAt: 0,
    attentionReason: "action",
    ...overrides,
  } as any;
}

function makeDeps(launcherInfo: Record<string, unknown> = {}) {
  return {
    isHerdedWorkerSession: vi.fn(() => false),
    getLauncherSessionInfo: vi.fn(() => launcherInfo),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    scheduleNotification: vi.fn(),
    cancelScheduledNotification: vi.fn(),
  };
}

describe("needs-input snooze", () => {
  it("suppresses the prompt and its pending phone alert without resolving it", () => {
    const session = makeSession();
    const deps = makeDeps();

    expect(snoozeNotification(session, "n-1", 50_000, deps)).toBe(true);

    expect(session.notifications[0]).toMatchObject({ muted: true, snoozedUntil: 50_000, done: false });
    expect(session.notifications[0].resolutionNotice).toBeUndefined();
    // A phone alert still waiting out its delay must not fire while the prompt is snoozed.
    expect(deps.cancelScheduledNotification).toHaveBeenCalledWith("s1", "n-1");
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      activeNeedsInputNotificationCount: 0,
      mutedNeedsInputNotificationCount: 1,
    });
    expect(session.attentionReason).toBeNull();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("refuses to snooze a resolved prompt", () => {
    const session = makeSession();
    session.notifications[0].done = true;
    expect(snoozeNotification(session, "n-1", 50_000, makeDeps())).toBe(false);
    expect(session.notifications[0].snoozedUntil).toBeUndefined();
  });

  it("wakes a due prompt as a fresh alert: active again, attention set, phone alert scheduled", () => {
    const session = makeSession();
    const deps = makeDeps();
    snoozeNotification(session, "n-1", 50_000, deps);

    // Not yet due: nothing changes.
    expect(wakeDueSnoozedNotifications([session], 49_999, deps)).toBe(0);
    expect(session.notifications[0].snoozedUntil).toBe(50_000);

    deps.broadcastToBrowsers.mockClear();
    expect(wakeDueSnoozedNotifications([session], 50_000, deps)).toBe(1);

    const notification = session.notifications[0];
    expect(notification.muted).toBeUndefined();
    expect(notification.mutedAt).toBeUndefined();
    expect(notification.snoozedUntil).toBeUndefined();
    expect(notification.done).toBe(false);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "needs-input",
      activeNeedsInputNotificationCount: 1,
      mutedNeedsInputNotificationCount: 0,
    });
    expect(session.attentionReason).toBe("action");
    expect(deps.scheduleNotification).toHaveBeenCalledWith("s1", "question", "Pick a plan", {
      skipReadCheck: true,
      notificationId: "n-1",
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "notification_update" }),
    );
  });

  it("reopens the owning leader quest tab when the reminder fires, like a new prompt", () => {
    const session = makeSession({
      state: {
        backend_type: "claude",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-77", closedAt: 2000 }],
          updatedAt: 2000,
        },
      },
    });
    session.notifications[0].threadKey = "q-77";
    session.notifications[0].questId = "q-77";
    const deps = makeDeps({ isOrchestrator: true });
    snoozeNotification(session, "n-1", 50_000, deps);

    wakeDueSnoozedNotifications([session], 60_000, deps);

    expect(session.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toContain("q-77");
  });

  it("leaves answered and archived prompts alone, and never alerts the phone for herded workers", () => {
    const answered = makeSession({ id: "answered" });
    const archived = makeSession({ id: "archived" });
    const worker = makeSession({ id: "worker" });
    const deps = makeDeps();
    for (const session of [answered, archived, worker]) snoozeNotification(session, "n-1", 50_000, deps);
    markNotificationDone(answered, "n-1", true, deps);
    deps.getLauncherSessionInfo.mockImplementation(((sessionId: string) =>
      sessionId === "archived" ? { archived: true } : {}) as any);
    deps.isHerdedWorkerSession.mockImplementation(((session: { id: string }) => session.id === "worker") as any);
    deps.scheduleNotification.mockClear();

    expect(wakeDueSnoozedNotifications([answered, archived, worker], 60_000, deps)).toBe(1);

    expect(answered.notifications[0]).toMatchObject({ done: true });
    expect(archived.notifications[0]).toMatchObject({ muted: true, snoozedUntil: 50_000 });
    // The worker's prompt returns to its active list, but worker prompts reach the leader, not the phone.
    expect(worker.notifications[0].snoozedUntil).toBeUndefined();
    expect(deps.scheduleNotification).not.toHaveBeenCalled();
  });

  it("cancelling (unmute) clears the snooze; muting turns it into an indefinite mute", () => {
    const deps = makeDeps();
    const cancelled = makeSession();
    snoozeNotification(cancelled, "n-1", 50_000, deps);
    setNotificationMuted(cancelled, "n-1", false, deps);
    expect(cancelled.notifications[0].muted).toBeUndefined();
    expect(cancelled.notifications[0].snoozedUntil).toBeUndefined();

    const muted = makeSession();
    snoozeNotification(muted, "n-1", 50_000, deps);
    setNotificationMuted(muted, "n-1", true, deps);
    expect(muted.notifications[0]).toMatchObject({ muted: true });
    expect(muted.notifications[0].snoozedUntil).toBeUndefined();
    expect(wakeDueSnoozedNotifications([muted], 60_000, deps)).toBe(0);
  });

  it("survives a server restart and wakes on the first sweep after it if the time passed meanwhile", async () => {
    const deps = makeDeps();
    const session = makeSession();
    snoozeNotification(session, "n-1", 50_000, deps);
    const sessions = new Map();
    await restorePersistedSessions(sessions, [buildPersistedSessionPayload(session)], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });
    const restored = sessions.get("s1");
    expect(restored.notifications[0]).toMatchObject({ muted: true, snoozedUntil: 50_000 });

    expect(wakeDueSnoozedNotifications(sessions.values(), 90_000, deps)).toBe(1);
    expect(restored.notifications[0].muted).toBeUndefined();
  });
});
