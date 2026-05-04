import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import { createTakodeRoutes, _resetThreadAttachmentHistoryBroadcastsForTest } from "./routes/takode.js";

function createTestApp(messageHistory: BrowserIncomingMessage[]) {
  const session = {
    id: "leader-1",
    messageHistory,
  };
  const bridge = {
    getSession: vi.fn(() => session),
    broadcastToSession: vi.fn(),
    persistSessionById: vi.fn(),
  };
  const app = new Hono();
  app.route(
    "/api",
    createTakodeRoutes({
      launcher: {
        listSessions: vi.fn(() => []),
        getSessionNum: vi.fn(() => 1286),
      },
      wsBridge: bridge,
      authenticateTakodeCaller: vi.fn(() => ({
        callerId: "leader-1",
        caller: { sessionId: "leader-1", isOrchestrator: true },
      })),
      resolveId: (id: string) => id,
    } as any),
  );

  return { app, bridge, session };
}

async function attach(app: Hono, body: Record<string, unknown>) {
  return app.request("/api/sessions/leader-1/thread/attach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sessions/:id/thread/attach", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetThreadAttachmentHistoryBroadcastsForTest();
    vi.useRealTimers();
  });

  it("coalesces rapid attach operations into one bounded attachment update without full history broadcast", async () => {
    const { app, bridge, session } = createTestApp([
      {
        type: "user_message",
        id: "u-q100",
        content: "[thread:q-100] prior quest context",
        timestamp: 1000,
        threadKey: "q-100",
        questId: "q-100",
      },
      { type: "user_message", id: "u-main", content: "main dispatch context", timestamp: 1001 },
    ]);

    await expect(attach(app, { questId: "q-1084", message: 0 }).then((res) => res.json())).resolves.toMatchObject({
      ok: true,
      attached: [0],
    });
    await expect(attach(app, { questId: "q-1084", message: 1 }).then((res) => res.json())).resolves.toMatchObject({
      ok: true,
      attached: [1],
    });
    await expect(attach(app, { questId: "q-1085", message: 0 }).then((res) => res.json())).resolves.toMatchObject({
      ok: true,
      attached: [0],
    });

    expect(bridge.persistSessionById).toHaveBeenCalledTimes(3);
    expect(bridge.broadcastToSession).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(bridge.broadcastToSession).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(bridge.broadcastToSession).toHaveBeenCalledTimes(1);
    const event = bridge.broadcastToSession.mock.calls[0]![1];
    expect(event).toMatchObject({
      type: "thread_attachment_update",
      version: 1,
      historyLength: session.messageHistory.length,
      affectedThreadKeys: expect.arrayContaining(["main", "q-1084", "q-1085", "q-100"]),
      maxDistanceFromTail: 300,
      maxChangedMessages: 100,
      updates: [
        expect.objectContaining({
          target: { threadKey: "q-1084", questId: "q-1084" },
          source: { threadKey: "q-100", questId: "q-100" },
          markerHistoryIndices: [2],
          changedMessages: [
            expect.objectContaining({
              historyIndex: 0,
              messageId: "u-q100",
              threadRefs: expect.arrayContaining([expect.objectContaining({ threadKey: "q-1084" })]),
            }),
          ],
        }),
        expect.objectContaining({
          target: { threadKey: "q-1084", questId: "q-1084" },
          markerHistoryIndices: [3],
          changedMessages: [expect.objectContaining({ historyIndex: 1, messageId: "u-main" })],
        }),
        expect.objectContaining({
          target: { threadKey: "q-1085", questId: "q-1085" },
          source: { threadKey: "q-100", questId: "q-100" },
          markerHistoryIndices: [4],
          changedMessages: [expect.objectContaining({ historyIndex: 0, messageId: "u-q100" })],
        }),
      ],
    });
    expect(event).not.toMatchObject({ type: "message_history" });

    const markers = session.messageHistory.filter((entry) => entry.type === "thread_attachment_marker");
    expect(markers).toHaveLength(3);
    expect(markers[0]).toMatchObject({
      type: "thread_attachment_marker",
      threadKey: "q-1084",
      questId: "q-1084",
      sourceThreadKey: "q-100",
      sourceQuestId: "q-100",
      messageIds: ["u-q100"],
      messageIndices: [0],
      ranges: ["0"],
      count: 1,
    });
    expect(session.messageHistory[0]?.threadRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadKey: "q-1084", questId: "q-1084", source: "backfill" }),
        expect.objectContaining({ threadKey: "q-1085", questId: "q-1085", source: "backfill" }),
      ]),
    );
    expect(session.messageHistory[1]?.threadRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ threadKey: "q-1084", questId: "q-1084", source: "backfill" })]),
    );
  });

  it("fails before mutation when selected messages are outside the recent bounded window", async () => {
    const history = Array.from(
      { length: 305 },
      (_, index): BrowserIncomingMessage => ({
        type: "user_message",
        id: `u-${index}`,
        content: `message ${index}`,
        timestamp: index,
      }),
    );
    const { app, bridge, session } = createTestApp(history);

    const res = await attach(app, { questId: "q-1087", message: 4 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "THREAD_ATTACH_OUTSIDE_RECENT_WINDOW",
      minAllowedIndex: 5,
      minSelectedIndex: 4,
    });
    expect(session.messageHistory[4]?.threadRefs).toBeUndefined();
    expect(session.messageHistory).toHaveLength(305);
    expect(bridge.persistSessionById).not.toHaveBeenCalled();
    expect(bridge.broadcastToSession).not.toHaveBeenCalled();
  });

  it("fails before mutation when a coalesced burst would attach more than the bounded message limit", async () => {
    const history = Array.from(
      { length: 130 },
      (_, index): BrowserIncomingMessage => ({
        type: "user_message",
        id: `u-${index}`,
        content: `message ${index}`,
        timestamp: index,
      }),
    );
    const { app, bridge, session } = createTestApp(history);

    const first = await attach(app, { questId: "q-1087", range: "20-69" });
    expect(first.status).toBe(200);
    const second = await attach(app, { questId: "q-1088", range: "70-120" });

    expect(second.status).toBe(400);
    await expect(second.json()).resolves.toMatchObject({
      code: "THREAD_ATTACH_TOO_MANY_MESSAGES",
      changedMessages: 51,
      pendingChangedMessages: 50,
      maxChangedMessages: 100,
    });
    expect(session.messageHistory[70]?.threadRefs).toBeUndefined();
    expect(bridge.persistSessionById).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(bridge.broadcastToSession).toHaveBeenCalledTimes(1);
    expect(bridge.broadcastToSession.mock.calls[0]![1]).toMatchObject({
      type: "thread_attachment_update",
      updates: [expect.objectContaining({ count: 50 })],
    });
  });
});
