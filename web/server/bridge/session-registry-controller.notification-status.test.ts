import { describe, expect, it, vi } from "vitest";
import {
  buildPersistedSessionPayload,
  clearAttentionAndMarkRead,
  getNotificationStatusSnapshot,
  getUserVisibleSessionNotifications,
  markAllNotificationsDone,
  markNotificationDone,
  notifyUser,
  recordThreadReadyUnreadNotifications,
  restorePersistedSessions,
  setNotificationMuted,
  setSessionClaimedQuest,
  updateLeaderGroupIdleState,
} from "./session-registry-controller.js";
import { replaceAttentionRecords } from "./attention-record-controller.js";
import { validateLeaderThreadOutcomes } from "./leader-thread-outcome-validator.js";
import type { SessionAttentionRecord } from "../session-types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { applyLeaderServerCandidateThreadTabEvent } from "../../shared/leader-open-thread-tabs.js";

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
    notifications: [],
    attentionRecords: [],
    notificationCounter: 0,
    taskHistory: [],
    keywords: [],
    lastReadAt: 0,
    attentionReason: null,
    ...overrides,
  } as any;
}

function leaderState(openThreadKeys: string[], closedThreadKeys: string[] = []) {
  return {
    backend_type: "claude",
    isOrchestrator: true,
    leaderOpenThreadTabs: {
      version: 1,
      orderedOpenThreadKeys: openThreadKeys,
      closedThreadTombstones: closedThreadKeys.map((threadKey, index) => ({
        threadKey,
        closedAt: 5000 + index,
      })),
      updatedAt: 6000,
    },
  };
}

function attentionRecord(overrides: Partial<SessionAttentionRecord> = {}): SessionAttentionRecord {
  return {
    id: "attention-1",
    leaderSessionId: "s1",
    type: "needs_input",
    source: { kind: "manual", id: "attention-1" },
    questId: "q-983",
    threadKey: "q-983",
    title: "Need decision",
    summary: "Need decision summary",
    actionLabel: "Answer",
    priority: "needs_input",
    state: "seen",
    createdAt: 100,
    updatedAt: 200,
    route: { threadKey: "q-983", questId: "q-983" },
    chipEligible: true,
    ledgerEligible: true,
    dedupeKey: "attention-1",
    ...overrides,
  };
}

function visibleLeaderMessage(id: string, timestamp: number) {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: "Visible leader output before restart" }],
      stop_reason: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    timestamp,
    threadKey: "main",
  };
}

function threadStatus({
  kind,
  threadKey = "q-1539",
  summary = kind === "ready" ? "quest complete" : "waiting on reviewer",
  messageId = `${kind}-message`,
  timestamp = 1000,
}: {
  kind: LeaderThreadStatus["kind"];
  threadKey?: string;
  summary?: string;
  messageId?: string;
  timestamp?: number;
}): LeaderThreadStatus {
  return {
    kind,
    label: kind === "ready" ? "Thread Ready" : "Thread Waiting",
    threadKey,
    ...(threadKey !== "main" ? { questId: threadKey } : {}),
    summary,
    messageId,
    timestamp,
    updatedAt: timestamp,
  };
}

function makeDeps() {
  return {
    isHerdedWorkerSession: () => false,
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    scheduleNotification: vi.fn(),
    cancelScheduledNotification: vi.fn(),
    emitTakodeEvent: vi.fn(),
    broadcastBoard: vi.fn(),
  };
}

describe("session claimed quest projection invalidation", () => {
  it("persists only explicitly identified claim and submission edges as routed lifecycle history", () => {
    // Claim state can be refreshed for titles, leaders, and review metadata.
    // Only the exact lifecycle edges belong in durable feed history.
    const session = makeSession({
      state: { backend_type: "claude", isOrchestrator: true },
      browserSockets: new Set(),
    });
    const broadcastToBrowsers = vi.fn();
    const deps = {
      broadcastToBrowsers,
      persistSession: vi.fn(),
      getLauncherSessionInfo: () => ({ isOrchestrator: true }),
      onSessionNamedByQuest: vi.fn(),
      invalidateLeaderThreadTabsForQuestIds: vi.fn(),
    };

    setSessionClaimedQuest(
      session,
      {
        id: "q-2003",
        title: "Diagnose recurring alerts",
        status: "done",
        verificationInboxUnread: true,
        tldr: "Findings are ready for review.",
        tags: ["security", "investigation"],
        leaderSessionId: "leader-1",
      },
      deps,
      { id: "quest_submitted-q-2003-leader-1000", kind: "submitted", timestamp: 1000 },
    );

    const submitted = session.messageHistory[0];
    expect(submitted).toMatchObject({
      type: "quest_lifecycle_event",
      kind: "submitted",
      threadKey: "q-2003",
      questId: "q-2003",
      threadRefs: [{ threadKey: "q-2003", questId: "q-2003", source: "explicit" }],
      quest: {
        questId: "q-2003",
        title: "Diagnose recurring alerts",
        status: "done",
        tldr: "Findings are ready for review.",
        tags: ["security", "investigation"],
        leaderSessionId: "leader-1",
      },
    });
    expect(submitted.id).toBe("quest_submitted-q-2003-leader-1000");
    expect(submitted.timestamp).toBe(1000);

    setSessionClaimedQuest(
      session,
      {
        id: "q-2003",
        title: "Diagnose recurring alerts (renamed)",
        status: "done",
        verificationInboxUnread: true,
        leaderSessionId: "leader-2",
      },
      deps,
    );
    expect(session.messageHistory).toHaveLength(1);

    setSessionClaimedQuest(session, { id: "q-2006", title: "Correct changelog dates", status: "in_progress" }, deps, {
      id: "quest_claimed-q-2006-worker-2000",
      kind: "claimed",
      timestamp: 2000,
    });
    expect(session.messageHistory).toHaveLength(2);
    expect(session.messageHistory[1]).toMatchObject({
      type: "quest_lifecycle_event",
      kind: "claimed",
      threadKey: "q-2006",
      questId: "q-2006",
      quest: { questId: "q-2006", title: "Correct changelog dates", status: "in_progress" },
    });
    expect(new Set(session.messageHistory.map((message: { id: string }) => message.id)).size).toBe(2);

    setSessionClaimedQuest(
      session,
      {
        id: "q-2003",
        title: "Diagnose recurring alerts (renamed)",
        status: "done",
        verificationInboxUnread: false,
      },
      deps,
    );
    setSessionClaimedQuest(session, { id: "q-2006", title: "Correct changelog dates", status: "in_progress" }, deps, {
      id: "quest_claimed-q-2006-worker-2000",
      kind: "claimed",
      timestamp: 2000,
    });
    expect(session.messageHistory).toHaveLength(2);
    expect(broadcastToBrowsers.mock.calls.map(([, message]) => message.type)).toEqual([
      "session_quest_claimed",
      "quest_lifecycle_event",
      "session_quest_claimed",
      "session_quest_claimed",
      "quest_lifecycle_event",
      "session_quest_claimed",
      "session_quest_claimed",
    ]);
  });

  it("invalidates only quest identity, status, or leader changes", () => {
    const session = makeSession({
      state: {
        backend_type: "claude",
        claimedQuestId: "q-1",
        claimedQuestTitle: "Earlier title",
        claimedQuestStatus: "done",
      },
      browserSockets: new Set(),
    });
    const invalidateLeaderThreadTabsForQuestIds = vi.fn();
    const deps = {
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      getLauncherSessionInfo: () => ({ isOrchestrator: false }),
      onSessionNamedByQuest: vi.fn(),
      invalidateLeaderThreadTabsForQuestIds,
    };

    setSessionClaimedQuest(
      session,
      { id: "q-1", title: "Renamed", status: "done", verificationInboxUnread: true },
      deps,
    );
    expect(invalidateLeaderThreadTabsForQuestIds).not.toHaveBeenCalled();
    expect(session.state).toMatchObject({
      claimedQuestTitle: "Renamed",
      claimedQuestVerificationInboxUnread: true,
    });

    setSessionClaimedQuest(
      session,
      { id: "q-1", title: "Renamed", status: "in_progress", verificationInboxUnread: true },
      deps,
    );
    setSessionClaimedQuest(
      session,
      {
        id: "q-1",
        title: "Renamed again",
        status: "in_progress",
        verificationInboxUnread: false,
        leaderSessionId: "leader-1",
      },
      deps,
    );
    setSessionClaimedQuest(
      session,
      {
        id: "q-2",
        title: "Current work",
        status: "in_progress",
        verificationInboxUnread: false,
        leaderSessionId: "leader-1",
      },
      deps,
    );
    setSessionClaimedQuest(
      session,
      {
        id: "q-2",
        title: "Current work",
        status: "in_progress",
        verificationInboxUnread: false,
        leaderSessionId: "leader-1",
      },
      deps,
    );

    expect(invalidateLeaderThreadTabsForQuestIds.mock.calls).toEqual([[["q-1"]], [["q-1"]], [["q-1", "q-2"]]]);
  });
});

describe("session notification status metadata", () => {
  it("emits review tab promotion edges for review notifications and new Thread Ready markers", () => {
    const session = makeSession({
      state: { backend_type: "claude", isOrchestrator: true },
      browserSockets: new Set(),
    });
    const promoteLeaderThreadTabForAttention = vi.fn();
    const deps = {
      ...makeDeps(),
      getLauncherSessionInfo: () => ({ isOrchestrator: true }),
      promoteLeaderThreadTabForAttention,
    };

    notifyUser(session, "review", "Review current quest", deps, {
      threadRoute: { threadKey: "q-42", questId: "q-42" },
    });
    expect(promoteLeaderThreadTabForAttention).toHaveBeenCalledWith(session.id, "q-42", expect.any(Number), "review");

    promoteLeaderThreadTabForAttention.mockClear();
    const ready = {
      kind: "ready" as const,
      label: "Thread Ready" as const,
      threadKey: "q-43",
      questId: "q-43",
      summary: "ready for review",
      messageId: "ready-q-43",
      timestamp: 200,
      updatedAt: 200,
    };
    expect(recordThreadReadyUnreadNotifications(session, [ready], deps)).toBe(true);
    expect(promoteLeaderThreadTabForAttention).toHaveBeenCalledWith(session.id, "q-43", 200, "review");
    expect(recordThreadReadyUnreadNotifications(session, [ready], deps)).toBe(false);
    expect(promoteLeaderThreadTabForAttention).toHaveBeenCalledTimes(1);
  });

  it("fences older server candidates after a newer needs-input promotion", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(300);
    const session = makeSession({
      state: {
        backend_type: "claude",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-newer", "q-needs-input", "q-delayed"],
          closedThreadTombstones: [],
          updatedAt: 200,
          latestServerCandidateEventAt: 200,
          serverCandidatePromotedAt: { "q-newer": 200 },
        },
      },
    });
    const deps = {
      ...makeDeps(),
      getLauncherSessionInfo: () => ({ isOrchestrator: true }),
    };

    try {
      notifyUser(session, "needs-input", "Need current decision", deps, {
        threadRoute: { threadKey: "q-needs-input", questId: "q-needs-input" },
      });

      const promoted = session.state.leaderOpenThreadTabs;
      expect(promoted).toMatchObject({
        orderedOpenThreadKeys: ["q-needs-input", "q-newer", "q-delayed"],
        latestServerCandidateEventAt: 300,
        serverCandidatePromotedAt: { "q-newer": 200, "q-needs-input": 300 },
      });
      expect(applyLeaderServerCandidateThreadTabEvent(promoted, "q-delayed", 250, { repositionExisting: true })).toBe(
        promoted,
      );
    } finally {
      now.mockRestore();
    }
  });

  it("increments metadata and includes it in notification updates", () => {
    const session = makeSession();
    const deps = makeDeps();

    notifyUser(session, "needs-input", "Need input", deps);

    expect(session.notificationStatusVersion).toBe(1);
    expect(typeof session.notificationStatusUpdatedAt).toBe("number");
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notificationStatusVersion: 1,
        notificationStatusUpdatedAt: session.notificationStatusUpdatedAt,
      }),
    );

    markNotificationDone(session, "n-1", true, deps);
    expect(session.notificationStatusVersion).toBe(2);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notificationStatusVersion: 2,
      }),
    );
  });

  it("tags explicit needs-input Pushover schedules with their notification id", () => {
    const session = makeSession();
    const deps = makeDeps();

    notifyUser(session, "needs-input", "Approve deploy", deps);

    expect(deps.scheduleNotification).toHaveBeenCalledWith("s1", "question", "Approve deploy", {
      skipReadCheck: true,
      notificationId: "n-1",
    });
  });

  it("cancels only the resolved needs-input notification's scheduled Pushover", () => {
    const session = makeSession({
      notifications: [
        { id: "n-1", category: "needs-input", summary: "Resolved", timestamp: 100, messageId: null, done: false },
        { id: "n-2", category: "needs-input", summary: "Still pending", timestamp: 101, messageId: null, done: false },
      ],
    });
    const deps = makeDeps();

    markNotificationDone(session, "n-1", true, deps);

    expect(deps.cancelScheduledNotification).toHaveBeenCalledTimes(1);
    expect(deps.cancelScheduledNotification).toHaveBeenCalledWith("s1", "n-1");
    expect(session.notifications[0].done).toBe(true);
    expect(session.notifications[1].done).toBe(false);
  });

  it("rebroadcasts fresh notification metadata for idempotent done operations", () => {
    const session = makeSession({
      notifications: [{ id: "n-1", category: "needs-input", summary: "Already done", timestamp: 1000, done: true }],
      notificationStatusVersion: 3,
      notificationStatusUpdatedAt: 3000,
      attentionReason: "action",
    });
    const deps = makeDeps();

    // Regression coverage: if a browser missed the original resolution event, a
    // later already-done resolve must still publish an authoritative zero count.
    expect(markNotificationDone(session, "n-1", true, deps)).toBe(true);
    expect(session.notificationStatusVersion).toBe(4);
    expect(session.attentionReason).toBeNull();
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notificationStatusVersion: 4,
        notifications: [expect.objectContaining({ id: "n-1", done: true })],
      }),
    );
    expect(deps.broadcastToBrowsers.mock.calls.some(([, message]) => message.type === "session_update")).toBe(false);

    deps.broadcastToBrowsers.mockClear();
    deps.persistSession.mockClear();

    expect(markAllNotificationsDone(session, true, deps)).toBe(0);
    expect(session.notificationStatusVersion).toBe(5);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notificationStatusVersion: 5,
      }),
    );
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("records external needs-input resolution notice state only when requested", () => {
    const session = makeSession({
      notifications: [
        { id: "n-1", category: "needs-input", summary: "Need answer", timestamp: 1000, done: false },
        { id: "n-2", category: "review", summary: "Review", timestamp: 1001, done: false },
      ],
    });
    const deps = makeDeps();

    expect(
      markNotificationDone(session, "n-1", true, deps, {
        resolutionNotice: "pending",
        resolutionNoticeSource: "manual",
      }),
    ).toBe(true);
    expect(session.notifications[0]).toMatchObject({
      done: true,
      resolutionNotice: { status: "pending", source: "manual" },
    });

    markNotificationDone(session, "n-1", false, deps);
    markNotificationDone(session, "n-2", true, deps, {
      resolutionNotice: "pending",
      resolutionNoticeSource: "manual",
    });
    expect(session.notifications[0]?.resolutionNotice).toBeUndefined();
    expect(session.notifications[1]?.resolutionNotice).toBeUndefined();
  });

  it("excludes legacy waiting markers from server notification status snapshots", () => {
    const session = makeSession({
      notifications: [
        { id: "waiting-1", category: "waiting", summary: "Waiting on lease", timestamp: 1000, done: false },
        { id: "n-1", category: "review", summary: "Ready", timestamp: 1001, messageId: null, done: false },
      ],
    });

    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: 1,
      notificationStatusUpdatedAt: 1001,
    });
  });

  it("treats review notifications at or before lastReadAt as already read", () => {
    const session = makeSession({
      lastReadAt: 2000,
      notifications: [
        { id: "n-old-review", category: "review", summary: "Old review", timestamp: 1000, done: false },
        { id: "n-new-review", category: "review", summary: "New review", timestamp: 3000, done: false },
        { id: "n-input", category: "needs-input", summary: "Need answer", timestamp: 1000, done: false },
      ],
    });

    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "needs-input",
      activeNotificationCount: 2,
      activeNeedsInputNotificationCount: 1,
      activeReviewNotificationCount: 1,
    });
  });

  it("uses one read- and open-target-aware projection for leader review status", () => {
    // Producer-shaped regression for q-1735: four historical unresolved rows
    // plus one newer closed-thread review must not become visible session unread.
    const session = makeSession({
      state: leaderState(["q-2000"], ["q-1001", "q-1002", "q-1003", "q-1004", "q-1710"]),
      lastReadAt: 2000,
      notificationStatusVersion: 7,
      notifications: [
        { id: "n-old-1", category: "review", timestamp: 1000, threadKey: "q-1001", done: false },
        { id: "n-old-2", category: "review", timestamp: 1100, threadKey: "q-1002", done: false },
        { id: "n-old-3", category: "review", timestamp: 1200, threadKey: "q-1003", done: false },
        { id: "n-old-4", category: "review", timestamp: 1300, threadKey: "q-1004", done: false },
        { id: "n-closed", category: "review", timestamp: 3000, threadKey: "q-1710", done: false },
      ],
    });
    const deps = makeDeps();

    expect(getUserVisibleSessionNotifications(session)).toEqual([]);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeReviewNotificationCount: 0,
      notificationStatusVersion: 7,
    });

    markNotificationDone(session, "n-old-1", true, deps);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notifications: [],
        notificationUrgency: null,
        activeNotificationCount: 0,
        activeReviewNotificationCount: 0,
      }),
    );
  });

  it("preserves legitimate unread review status for an open leader thread", () => {
    const session = makeSession({
      state: leaderState(["q-2000"], ["q-1710"]),
      lastReadAt: 2000,
      notifications: [
        { id: "n-closed", category: "review", timestamp: 3000, threadKey: "q-1710", done: false },
        { id: "n-open", category: "review", timestamp: 4000, threadKey: "q-2000", done: false },
      ],
    });

    expect(getUserVisibleSessionNotifications(session).map((notification) => notification.id)).toEqual(["n-open"]);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
    });
  });

  it("marking a session read broadcasts a cleared review-notification status", () => {
    const session = makeSession({
      attentionReason: null,
      notificationStatusVersion: 4,
      notifications: [{ id: "n-review", category: "review", summary: "Review", timestamp: 1000, done: false }],
    });
    const deps = makeDeps();

    clearAttentionAndMarkRead(session, deps);

    expect(session.attentionReason).toBeNull();
    expect(session.lastReadAt).toBeGreaterThanOrEqual(1000);
    expect(session.notificationStatusVersion).toBe(5);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeReviewNotificationCount: 0,
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notifications: [],
        notificationStatusVersion: 5,
      }),
    );
    expect(deps.broadcastToBrowsers.mock.calls.some(([, message]) => message.type === "session_update")).toBe(false);
  });

  it("clears explicit manual unread authority on an authoritative read", () => {
    const session = makeSession({ attentionReason: "review", manualUnread: true, notificationStatusVersion: 4 });
    const deps = makeDeps();

    clearAttentionAndMarkRead(session, deps);

    expect(session.manualUnread).toBe(false);
    expect(session.attentionReason).toBeNull();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("does not clear explicit manual unread during group-idle bookkeeping", () => {
    const leader = makeSession({ id: "leader", attentionReason: "review", manualUnread: true, isGenerating: false });
    const worker = makeSession({ id: "worker", isGenerating: true });
    const idleState = {
      timer: null,
      idleSince: 100,
      notifiedWhileIdle: true,
      leaderUnreadSetByGroupIdle: true,
    };
    const clearAttentionAndMarkRead = vi.fn();

    updateLeaderGroupIdleState(
      {
        sessions: new Map([
          [leader.id, leader],
          [worker.id, worker],
        ]),
        leaderGroupIdleStates: new Map([[leader.id, idleState]]),
      },
      leader.id,
      "worker_active",
      {
        getLauncherSessionInfo: () => ({ isOrchestrator: true }),
        getHerdedSessionIds: () => [worker.id],
        getSessionNum: () => 1,
        getSessionName: () => "Leader",
        deriveSessionStatus: (session) => (session.isGenerating ? "running" : "idle"),
        clearAttentionAndMarkRead,
        setAttentionReview: vi.fn(),
        scheduleCompletedNotification: vi.fn(),
        broadcastLeaderGroupIdle: vi.fn(),
        recordServerEvent: vi.fn(),
        delayMs: 1000,
      },
    );

    expect(clearAttentionAndMarkRead).not.toHaveBeenCalled();
    expect(leader).toMatchObject({ attentionReason: "review", manualUnread: true });
    expect(idleState.leaderUnreadSetByGroupIdle).toBe(false);
  });

  it("keeps thread-scoped Thread Ready unread when an automatic session-view read fires from Main", () => {
    const session = makeSession({
      state: leaderState(["q-1563"]),
      attentionReason: "review",
      notificationStatusVersion: 4,
    });
    const deps = makeDeps();
    recordThreadReadyUnreadNotifications(
      session,
      [threadStatus({ kind: "ready", threadKey: "q-1563", timestamp: 1000, messageId: "ready-q1563" })],
      deps,
    );
    deps.broadcastToBrowsers.mockClear();
    deps.persistSession.mockClear();

    // The user has the leader session open on Main, but has not viewed q-1563.
    // This must clear only the session-level attention flag; advancing the
    // broad lastReadAt timestamp would make q-1563 look read by timestamp.
    clearAttentionAndMarkRead(session, deps, { mode: "session-view" });

    expect(session.attentionReason).toBeNull();
    expect(session.lastReadAt).toBe(0);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
    });
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "notification_update" }),
    );
  });

  it("keeps broad explicit read behavior for thread-scoped Thread Ready unread", () => {
    const session = makeSession({
      state: leaderState(["q-1563"]),
      attentionReason: "review",
      notificationStatusVersion: 4,
    });
    const deps = makeDeps();
    recordThreadReadyUnreadNotifications(
      session,
      [threadStatus({ kind: "ready", threadKey: "q-1563", timestamp: 1000, messageId: "ready-q1563" })],
      deps,
    );
    deps.broadcastToBrowsers.mockClear();

    clearAttentionAndMarkRead(session, deps);

    expect(session.lastReadAt).toBeGreaterThanOrEqual(1000);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeReviewNotificationCount: 0,
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notifications: [],
      }),
    );
  });

  it("counts muted needs-input separately from active attention", () => {
    const session = makeSession({
      attentionReason: "action",
      notifications: [
        { id: "n-1", category: "needs-input", summary: "Muted", timestamp: 1000, messageId: null, done: false },
        { id: "n-2", category: "needs-input", summary: "Active", timestamp: 1001, messageId: null, done: false },
      ],
    });
    const deps = makeDeps();

    expect(setNotificationMuted(session, "n-1", true, deps)).toBe(true);
    expect(session.notifications[0]).toMatchObject({ muted: true });
    expect(session.notifications[0].resolutionNotice).toBeUndefined();
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 1,
      mutedNeedsInputNotificationCount: 1,
    });

    expect(setNotificationMuted(session, "n-2", true, deps)).toBe(true);
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeNeedsInputNotificationCount: 0,
      mutedNeedsInputNotificationCount: 2,
    });
    expect(session.attentionReason).toBeNull();

    expect(setNotificationMuted(session, "n-1", false, deps)).toBe(true);
    expect(session.notifications[0].muted).toBeUndefined();
    expect(getNotificationStatusSnapshot(session)).toMatchObject({
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 1,
      mutedNeedsInputNotificationCount: 1,
    });
    expect(session.attentionReason).toBe("action");
  });

  it("applies inferred thread route metadata to fallback needs-input anchor messages", () => {
    const session = makeSession({
      messageHistory: [
        {
          type: "user_message",
          id: "u-q968",
          content: "Quest-scoped context",
          timestamp: 1,
          threadKey: "q-968",
          questId: "q-968",
          threadRefs: [{ threadKey: "q-968", questId: "q-968", source: "explicit" }],
        },
      ],
    });
    const deps = {
      ...makeDeps(),
      getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true })),
    };

    notifyUser(session, "needs-input", "Need q-968 input", deps);

    expect(session.messageHistory[1]).toMatchObject({
      type: "leader_user_message",
      content: "Needs input: Need q-968 input",
      threadKey: "q-968",
      questId: "q-968",
      threadRefs: [{ threadKey: "q-968", questId: "q-968", source: "explicit" }],
    });
    expect(session.notifications[0]).toMatchObject({
      category: "needs-input",
      threadKey: "q-968",
      questId: "q-968",
      messageId: session.messageHistory[1].id,
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "leader_user_message",
        threadKey: "q-968",
        questId: "q-968",
      }),
    );
  });

  it("logs and normalizes notifications when anchored thread metadata diverges", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = makeSession({
      messageHistory: [
        {
          type: "assistant",
          message: { id: "asst-q977", content: [{ type: "text", text: "Need q-977 decision" }] },
          timestamp: 1,
          threadKey: "q-977",
          questId: "q-978",
          threadRefs: [{ threadKey: "q-977", questId: "q-977", source: "explicit" }],
        },
      ],
    });
    const deps = makeDeps();

    try {
      notifyUser(session, "needs-input", "Need q-977 input", deps);

      expect(session.notifications[0]).toMatchObject({
        id: "n-1",
        threadKey: "q-977",
        questId: "q-977",
        messageId: "asst-q977",
      });
      expect(session.messageHistory[0].notification).toMatchObject({
        id: "n-1",
        threadKey: "q-977",
        questId: "q-977",
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Anchor route metadata diverged"));
    } finally {
      warn.mockRestore();
    }
  });

  it("persists and restores notification status metadata", async () => {
    const persisted = buildPersistedSessionPayload(
      makeSession({
        notifications: [
          { id: "n-1", category: "needs-input", timestamp: 1000, messageId: null, done: false, muted: true },
        ],
        notificationStatusVersion: 9,
        notificationStatusUpdatedAt: 9000,
      }),
    );
    expect(persisted).toMatchObject({
      notificationStatusVersion: 9,
      notificationStatusUpdatedAt: 9000,
      notifications: [expect.objectContaining({ id: "n-1", muted: true })],
    });

    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });

    expect(sessions.get("s1")).toMatchObject({
      notificationStatusVersion: 9,
      notificationStatusUpdatedAt: 9000,
      notifications: [expect.objectContaining({ id: "n-1", muted: true })],
    });
  });

  it("persists active Codex model-switch compaction guards and drops expired guards on restore", async () => {
    const now = Date.now();
    const persisted = buildPersistedSessionPayload(
      makeSession({
        state: { backend_type: "codex" },
        codexModelSwitchCompactionGuard: {
          previousModel: "gpt-5.5",
          nextModel: "gpt-5.6-sol",
          createdAt: now,
          expiresAt: now + 60_000,
          modelActivityObserved: true,
        },
      }),
    );
    expect(persisted.codexModelSwitchCompactionGuard).toMatchObject({
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      modelActivityObserved: true,
    });

    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });

    expect(sessions.get("s1")?.codexModelSwitchCompactionGuard).toMatchObject({
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      modelActivityObserved: true,
    });

    const expired = {
      ...persisted,
      id: "expired",
      codexModelSwitchCompactionGuard: {
        previousModel: "gpt-5.5",
        nextModel: "gpt-5.6-sol",
        createdAt: now - 120_000,
        expiresAt: now - 60_000,
      },
    };
    const expiredSessions = new Map<string, any>();
    await restorePersistedSessions(expiredSessions, [expired], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });

    expect(expiredSessions.get("expired")?.codexModelSwitchCompactionGuard).toBeNull();
  });

  it("persists and restores the leader thread outcome cursor without revalidating old history", async () => {
    const persisted = buildPersistedSessionPayload(
      makeSession({
        messageHistory: [visibleLeaderMessage("a-before-restart", 1000)],
        leaderThreadOutcomeValidatedHistoryLength: 1,
      }),
    );
    expect(persisted).toMatchObject({
      leaderThreadOutcomeValidatedHistoryLength: 1,
    });

    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });

    const restored = sessions.get("s1");
    expect(restored).toMatchObject({
      leaderThreadOutcomeValidatedHistoryLength: 1,
    });

    const validationDeps = {
      isLeaderSession: vi.fn(() => true),
      injectUserMessage: vi.fn(() => "sent" as const),
      persistSession: vi.fn(),
    };

    expect(validateLeaderThreadOutcomes(restored, validationDeps)).toEqual({
      checked: false,
      reason: "no_new_history",
    });
    expect(validationDeps.injectUserMessage).not.toHaveBeenCalled();
    expect(validationDeps.persistSession).not.toHaveBeenCalled();
  });

  it("bootstraps missing leader outcome cursors to restored history length", async () => {
    const persisted = buildPersistedSessionPayload(
      makeSession({
        messageHistory: [visibleLeaderMessage("a-old-1", 1000), visibleLeaderMessage("a-old-2", 2000)],
      }),
    ) as unknown as Record<string, unknown>;
    delete persisted.leaderThreadOutcomeValidatedHistoryLength;

    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });

    const restored = sessions.get("s1");
    expect(restored).toMatchObject({
      leaderThreadOutcomeValidatedHistoryLength: 2,
    });

    const validationDeps = {
      isLeaderSession: vi.fn(() => true),
      injectUserMessage: vi.fn(() => "sent" as const),
      persistSession: vi.fn(),
    };

    expect(validateLeaderThreadOutcomes(restored, validationDeps)).toEqual({
      checked: false,
      reason: "no_new_history",
    });
    expect(validationDeps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("broadcasts, persists, and restores server-authoritative attention records", async () => {
    const session = makeSession();
    const deps = makeDeps();
    const records = [
      attentionRecord({ id: "seen-record", state: "seen", dedupeKey: "seen-record" }),
      attentionRecord({ id: "dismissed-record", state: "dismissed", dedupeKey: "dismissed-record" }),
      attentionRecord({ id: "reopened-record", state: "reopened", dedupeKey: "reopened-record" }),
      attentionRecord({ id: "superseded-record", state: "superseded", dedupeKey: "superseded-record" }),
    ];

    replaceAttentionRecords(session, records, deps);

    expect(session.attentionRecords.map((record: SessionAttentionRecord) => record.state)).toEqual([
      "seen",
      "dismissed",
      "reopened",
      "superseded",
    ]);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "attention_records_update",
        attentionRecords: records,
      }),
    );
    expect(deps.persistSession).toHaveBeenCalledWith(session);

    const persisted = buildPersistedSessionPayload(session);
    expect(persisted.attentionRecords?.map((record) => record.state)).toEqual([
      "seen",
      "dismissed",
      "reopened",
      "superseded",
    ]);

    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted], {
      recoverToolStartTimesFromHistory: vi.fn(),
      finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
      scheduleCodexToolResultWatchdogs: vi.fn(),
      reconcileRestoredBoardState: vi.fn(async () => {}),
    });

    expect(sessions.get("s1")?.attentionRecords.map((record: SessionAttentionRecord) => record.state)).toEqual([
      "seen",
      "dismissed",
      "reopened",
      "superseded",
    ]);
  });

  it("records Thread Ready status markers as internal review unread notifications", () => {
    const session = makeSession({ state: { isOrchestrator: true } });
    const deps = makeDeps();
    const ready = threadStatus({ kind: "ready", threadKey: "q-1539", summary: "quest complete" });

    const changed = recordThreadReadyUnreadNotifications(session, [ready], deps);

    expect(changed).toBe(true);
    expect(session.notifications).toEqual([
      expect.objectContaining({
        id: "n-1",
        category: "review",
        summary: "Thread ready: q-1539 | quest complete",
        threadKey: "q-1539",
        questId: "q-1539",
        messageId: "ready-message",
        done: false,
      }),
    ]);
    expect(session.attentionReason).toBe("review");
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "notification_update",
        notifications: [
          expect.objectContaining({
            category: "review",
            threadKey: "q-1539",
          }),
        ],
      }),
    );
    expect(deps.scheduleNotification).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("does not create unread notifications for Thread Waiting markers", () => {
    const session = makeSession({ state: { isOrchestrator: true } });
    const deps = makeDeps();

    const changed = recordThreadReadyUnreadNotifications(
      session,
      [threadStatus({ kind: "waiting", threadKey: "q-1539" })],
      deps,
    );

    expect(changed).toBe(false);
    expect(session.notifications).toEqual([]);
    expect(session.attentionReason).toBeNull();
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it("deduplicates replayed Thread Ready markers and preserves active needs-input priority", () => {
    const session = makeSession({ state: { isOrchestrator: true }, attentionReason: "action" });
    const deps = makeDeps();
    const ready = threadStatus({ kind: "ready", threadKey: "q-1539", summary: "quest complete" });

    expect(recordThreadReadyUnreadNotifications(session, [ready], deps)).toBe(true);
    expect(recordThreadReadyUnreadNotifications(session, [ready], deps)).toBe(false);

    expect(session.notifications).toHaveLength(1);
    expect(session.attentionReason).toBe("action");
  });
});
