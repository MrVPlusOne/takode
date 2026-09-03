import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { registerTakodeThreadResponseRoutes } from "./takode-thread-response.js";
import type { RouteContext } from "./context.js";

function fixture() {
  const session = {
    id: "leader-1",
    state: {
      leaderThreadStatuses: {
        main: {
          kind: "ready",
          label: "Thread Ready",
          threadKey: "main",
          summary: "old",
          messageId: "old-ready",
          timestamp: 0,
          updatedAt: 0,
        },
      },
    },
    messageHistory: [
      {
        type: "user_message",
        id: "u1",
        content: "Please handle this.",
        timestamp: 1,
        threadKey: "main",
        leaderResponseCoverageVersion: 1,
      },
    ] as BrowserIncomingMessage[],
  };
  const broadcastToSession = vi.fn();
  const persistSessionById = vi.fn();
  const refreshSessionConversation = vi.fn();
  const invalidateLeaderThreadTabsForSession = vi.fn(() => true);
  const context = {
    resolveId: (value: string) => (value === "leader-1" || value === "other" ? value : null),
    authenticateTakodeCaller: vi.fn(() => ({
      callerId: "leader-1",
      caller: { sessionId: "leader-1", isOrchestrator: true },
    })),
    wsBridge: {
      getSession: (id: string) => (id === "leader-1" ? session : undefined),
      broadcastToSession,
      persistSessionById,
      refreshSessionConversation,
      getSyncedProjectionController: () => ({ invalidateLeaderThreadTabsForSession }),
    },
  } as unknown as RouteContext;
  const app = new Hono();
  registerTakodeThreadResponseRoutes(app, context);
  return {
    app,
    session,
    broadcastToSession,
    persistSessionById,
    refreshSessionConversation,
    invalidateLeaderThreadTabsForSession,
  };
}

async function getState(app: Hono, threadKey = "main") {
  const response = await app.request(`/sessions/leader-1/thread-responses/${threadKey}`);
  return { response, body: (await response.json()) as any };
}

async function put(app: Hono, body: Record<string, unknown>, threadKey = "main", sessionId = "leader-1") {
  return app.request(`/sessions/${sessionId}/thread-responses/${threadKey}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Takode thread response routes", () => {
  it("creates an ID-free server-batch response and publishes one routed history message", async () => {
    const {
      app,
      session,
      broadcastToSession,
      persistSessionById,
      refreshSessionConversation,
      invalidateLeaderThreadTabsForSession,
    } = fixture();
    const observed = await getState(app);
    const token = observed.body.responseState.pendingBatches[0].token;

    const response = await put(app, {
      intent: "create",
      pendingBatchToken: token,
      baseRevisionId: null,
      markdown: "Handled.",
      idempotencyKey: "create-1",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.response).toMatchObject({ coveredMessageCount: 1, revisionCount: 1 });
    expect(body.response).not.toHaveProperty("coveredUserMessageIds");
    expect(body.responseState).toMatchObject({ pendingMessageCount: 0, ready: true });
    expect(session.messageHistory.at(-1)).toMatchObject({
      type: "leader_user_message",
      id: body.response.currentMessageId,
      threadKey: "main",
      threadResponse: { revisionId: body.response.currentRevisionId, coveredUserMessageIds: ["u1"] },
    });
    expect(session.state.leaderThreadStatuses.main).toBeUndefined();
    expect(invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith("leader-1");
    expect(broadcastToSession).toHaveBeenCalledOnce();
    expect(persistSessionById).toHaveBeenCalledWith("leader-1");
    expect(refreshSessionConversation).toHaveBeenCalledWith("leader-1");
  });

  it("revises by response identity and base revision without changing batch membership", async () => {
    const { app } = fixture();
    const observed = await getState(app);
    const created = await put(app, {
      intent: "create",
      pendingBatchToken: observed.body.responseState.pendingBatches[0].token,
      baseRevisionId: null,
      markdown: "Initial.",
    });
    const first = (await created.json()) as any;

    const revised = await put(app, {
      intent: "revise",
      responseId: first.response.logicalResponseId,
      baseRevisionId: first.response.currentRevisionId,
      markdown: "Polished.",
    });

    expect(revised.status).toBe(200);
    expect((await revised.json()) as any).toMatchObject({
      response: { logicalResponseId: first.response.logicalResponseId, revisionCount: 2, coveredMessageCount: 1 },
    });
  });

  it("rejects user-message IDs, stale batch tokens, wrong sessions, and invalid intents", async () => {
    const { app, session } = fixture();
    const observed = await getState(app);
    const token = observed.body.responseState.pendingBatches[0].token;

    expect(
      (
        await put(app, {
          intent: "create",
          pendingBatchToken: token,
          baseRevisionId: null,
          markdown: "No.",
          userMessageIds: ["u1"],
        })
      ).status,
    ).toBe(400);
    session.messageHistory.splice(0, 1);
    expect(
      (
        await put(app, {
          intent: "create",
          pendingBatchToken: token,
          baseRevisionId: null,
          markdown: "Stale.",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await put(
          app,
          {
            intent: "create",
            pendingBatchToken: token,
            baseRevisionId: null,
            markdown: "Wrong owner.",
          },
          "main",
          "other",
        )
      ).status,
    ).toBe(403);
    expect((await put(app, { intent: "other", markdown: "Invalid." })).status).toBe(400);
  });
});
