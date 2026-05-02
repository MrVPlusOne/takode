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

  it("coalesces rapid attach operations into one authoritative history broadcast", async () => {
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
    expect(bridge.broadcastToSession).toHaveBeenCalledWith("leader-1", {
      type: "message_history",
      messages: session.messageHistory,
    });

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
});
