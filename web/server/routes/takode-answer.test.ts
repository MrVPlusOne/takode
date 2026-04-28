import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createTakodeRoutes } from "./takode.js";

function createTestApp() {
  const session = {
    id: "orch-1",
    pendingPermissions: new Map([
      [
        "req-exit-plan",
        {
          request_id: "req-exit-plan",
          tool_name: "ExitPlanMode",
          timestamp: 2000,
          input: { plan: "Step 1: fix the approval path", allowedPrompts: [] },
        },
      ],
    ]),
    notifications: [],
    messageHistory: [{ type: "permission_request", request: { request_id: "req-exit-plan" } }],
  };

  const handleBrowserMessage = vi.fn(async (_ws: any, _raw: string) => {});
  const broadcastToSession = vi.fn();
  const persistSessionById = vi.fn();
  const launcher = {
    resolveSessionId: vi.fn((id: string) => id),
    getSession: vi.fn((id: string) =>
      id === "worker-1" ? { sessionId: "worker-1", herdedBy: "orch-1" } : { sessionId: "orch-1", isOrchestrator: true },
    ),
  };

  const app = new Hono();
  app.route(
    "/api",
    createTakodeRoutes({
      launcher,
      wsBridge: {
        getSession: vi.fn(() => session),
        handleBrowserMessage,
        broadcastToSession,
        persistSessionById,
        emitTakodeEvent: vi.fn(),
      },
      authenticateTakodeCaller: vi.fn(() => ({
        callerId: "orch-1",
        caller: { sessionId: "orch-1", isOrchestrator: true },
      })),
      resolveId: (id: string) => id,
    } as any),
  );

  return { app, handleBrowserMessage, broadcastToSession, persistSessionById, session };
}

describe("takode answer permission routing", () => {
  it("routes ExitPlanMode approval through the real bridge browser-message entrypoint", async () => {
    const { app, handleBrowserMessage } = createTestApp();

    const res = await app.request("/api/sessions/worker-1/answer", {
      method: "POST",
      body: JSON.stringify({ response: "approve" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "permission",
      tool_name: "ExitPlanMode",
      action: "approved",
    });
    expect(handleBrowserMessage).toHaveBeenCalledTimes(1);

    const [ws, raw] = handleBrowserMessage.mock.calls[0]!;
    expect(ws.data).toEqual({ kind: "browser", sessionId: "worker-1" });
    expect(JSON.parse(raw)).toEqual({
      type: "permission_response",
      request_id: "req-exit-plan",
      behavior: "allow",
      updated_input: { plan: "Step 1: fix the approval path", allowedPrompts: [] },
      actorSessionId: "orch-1",
    });
  });
});

describe("takode user-message", () => {
  it("appends and broadcasts an explicit leader-visible message for the caller session", async () => {
    const { app, broadcastToSession, persistSessionById, session } = createTestApp();
    const now = vi.spyOn(Date, "now").mockReturnValue(123456);

    try {
      const res = await app.request("/api/sessions/orch-1/user-message", {
        method: "POST",
        body: JSON.stringify({ content: "Visible **leader** update" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        sessionId: "orch-1",
        messageId: "leader-user-123456-1",
      });
      const expected = {
        type: "leader_user_message",
        id: "leader-user-123456-1",
        content: "Visible **leader** update",
        timestamp: 123456,
      };
      expect(session.messageHistory.at(-1)).toEqual(expected);
      expect(broadcastToSession).toHaveBeenCalledWith("orch-1", expected);
      expect(persistSessionById).toHaveBeenCalledWith("orch-1");
    } finally {
      now.mockRestore();
    }
  });

  it("rejects publishing a user-visible message for another session", async () => {
    const { app } = createTestApp();

    const res = await app.request("/api/sessions/worker-1/user-message", {
      method: "POST",
      body: JSON.stringify({ content: "Wrong target" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Can only publish a user-visible message from your own session" });
  });
});

describe("takode notify needs-input left-panel visibility", () => {
  it("creates a visible fallback message when no explicit leader user-message exists", async () => {
    const { app, broadcastToSession, session } = createTestApp();
    const now = vi.spyOn(Date, "now").mockReturnValue(223344);

    try {
      const res = await app.request("/api/sessions/orch-1/notify", {
        method: "POST",
        body: JSON.stringify({ category: "needs-input", summary: "Need routing decision" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        category: "needs-input",
        anchoredMessageId: "leader-needs-input-223344-1",
        rawNotificationId: "n-1",
      });
      expect(session.messageHistory.at(-1)).toMatchObject({
        type: "leader_user_message",
        id: "leader-needs-input-223344-1",
        content: "Needs input: Need routing decision",
        notification: {
          id: "n-1",
          category: "needs-input",
          summary: "Need routing decision",
          timestamp: 223344,
        },
      });
      expect(broadcastToSession).toHaveBeenCalledWith(
        "orch-1",
        expect.objectContaining({
          type: "leader_user_message",
          id: "leader-needs-input-223344-1",
        }),
      );
    } finally {
      now.mockRestore();
    }
  });
});
