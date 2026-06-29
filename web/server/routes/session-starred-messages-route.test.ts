import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerSessionStarredMessagesRoute } from "./session-starred-messages-route.js";
import type { BrowserIncomingMessage, StarredMessageRecord } from "../session-types.js";

function user(id: string | undefined, content = "hello"): BrowserIncomingMessage {
  return {
    type: "user_message",
    ...(id ? { id } : {}),
    content,
    timestamp: 10,
  };
}

function assistant(id: string, content = "assistant text"): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude",
      content: [{ type: "text", text: content }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 20,
  };
}

function makeRoute(history: BrowserIncomingMessage[]) {
  const sessionId = "session-abc";
  const bridgeSession: {
    id: string;
    messageHistory: BrowserIncomingMessage[];
    state: { session_id: string; starredMessages: Record<string, StarredMessageRecord> };
  } = {
    id: sessionId,
    messageHistory: history,
    state: { session_id: sessionId, starredMessages: {} },
  };
  const persistSessionById = vi.fn();
  const broadcastToSession = vi.fn();
  const api = new Hono();
  registerSessionStarredMessagesRoute(api, {
    launcher: {
      getSession: vi.fn(() => ({ sessionId, cwd: "/repo", createdAt: 1 })),
    } as any,
    wsBridge: {
      getSession: vi.fn((id: string) => (id === sessionId ? bridgeSession : null)),
      persistSessionById,
      broadcastToSession,
    } as any,
    resolveId: vi.fn((raw: string) => (raw === sessionId || raw === "123" ? sessionId : null)),
  });
  return { api, bridgeSession, persistSessionById, broadcastToSession };
}

describe("session starred messages route", () => {
  it("stars stable user and assistant messages and broadcasts authoritative state", async () => {
    const { api, bridgeSession, persistSessionById, broadcastToSession } = makeRoute([user("u1"), assistant("a1")]);

    const res = await api.request("/sessions/123/starred-messages/u1", {
      method: "PUT",
      body: JSON.stringify({ historyIndex: 0 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.starredMessages.u1).toMatchObject({ messageId: "u1", role: "user", historyIndex: 0 });
    expect(bridgeSession.state.starredMessages.u1).toMatchObject({ messageId: "u1" });
    expect(persistSessionById).toHaveBeenCalledWith("session-abc");
    expect(broadcastToSession).toHaveBeenCalledWith("session-abc", {
      type: "session_update",
      session: { starredMessages: expect.objectContaining({ u1: expect.any(Object) }) },
    });

    const assistantRes = await api.request("/sessions/123/starred-messages/a1", { method: "PUT" });
    const assistantBody = await assistantRes.json();
    expect(assistantBody.starredMessages.a1).toMatchObject({ messageId: "a1", role: "assistant", historyIndex: 1 });
  });

  it("rejects fallback-id and tool-only targets", async () => {
    const { api } = makeRoute([
      user(undefined),
      {
        ...assistant("tool-only", ""),
        message: {
          ...(assistant("tool-only", "") as Extract<BrowserIncomingMessage, { type: "assistant" }>).message,
          content: [{ type: "tool_use", id: "tool-1", name: "Read", input: {} }],
        },
      } as BrowserIncomingMessage,
    ]);

    expect((await api.request("/sessions/123/starred-messages/history-0", { method: "PUT" })).status).toBe(400);
    expect((await api.request("/sessions/123/starred-messages/tool-only", { method: "PUT" })).status).toBe(400);
  });

  it("treats repeated star and unstar operations as idempotent", async () => {
    const { api, persistSessionById, broadcastToSession } = makeRoute([user("u1")]);

    await api.request("/sessions/123/starred-messages/u1", { method: "PUT" });
    persistSessionById.mockClear();
    broadcastToSession.mockClear();

    expect((await api.request("/sessions/123/starred-messages/u1", { method: "PUT" })).status).toBe(200);
    expect(persistSessionById).not.toHaveBeenCalled();
    expect(broadcastToSession).not.toHaveBeenCalled();

    expect((await api.request("/sessions/123/starred-messages/u1", { method: "DELETE" })).status).toBe(200);
    persistSessionById.mockClear();
    broadcastToSession.mockClear();

    expect((await api.request("/sessions/123/starred-messages/u1", { method: "DELETE" })).status).toBe(200);
    expect(persistSessionById).not.toHaveBeenCalled();
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
