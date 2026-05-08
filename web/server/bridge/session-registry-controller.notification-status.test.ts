import { describe, expect, it, vi } from "vitest";
import {
  buildPersistedSessionPayload,
  markNotificationDone,
  notifyUser,
  restorePersistedSessions,
} from "./session-registry-controller.js";
import { replaceAttentionRecords } from "./attention-record-controller.js";
import type { SessionAttentionRecord } from "../session-types.js";

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

function makeDeps() {
  return {
    isHerdedWorkerSession: () => false,
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    scheduleNotification: vi.fn(),
    emitTakodeEvent: vi.fn(),
    broadcastBoard: vi.fn(),
  };
}

describe("session notification status metadata", () => {
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

  it("records waiting notifications without setting user attention or scheduling a push", () => {
    const session = makeSession();
    const deps = makeDeps();

    notifyUser(session, "waiting", "Waiting on reviewer", deps);

    expect(session.notifications).toMatchObject([{ category: "waiting", summary: "Waiting on reviewer", done: false }]);
    expect(session.attentionReason).toBeNull();
    expect(deps.scheduleNotification).not.toHaveBeenCalled();
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
        notifications: [{ id: "n-1", category: "needs-input", timestamp: 1000, messageId: null, done: false }],
        notificationStatusVersion: 9,
        notificationStatusUpdatedAt: 9000,
      }),
    );
    expect(persisted).toMatchObject({
      notificationStatusVersion: 9,
      notificationStatusUpdatedAt: 9000,
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
    });
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
});
