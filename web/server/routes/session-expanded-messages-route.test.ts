import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { MAX_EXPANDED_MESSAGES, registerSessionExpandedMessagesRoute } from "./session-expanded-messages-route.js";
import type { BrowserIncomingMessage } from "../session-types.js";

// Which messages show their long content expanded is server-owned session state: every
// browser of the session gets it, and it survives reloads.

function user(id: string): BrowserIncomingMessage {
  return { type: "user_message", id, content: "a long message", timestamp: 10 };
}

function report(id: string): BrowserIncomingMessage {
  return {
    type: "markdown_report",
    id,
    content: "# Report",
    timestamp: 20,
    source: { sessionId: "session-abc", sourcePath: "/repo/report.md", sha256: "abc" },
  } as BrowserIncomingMessage;
}

function makeRoute(history: BrowserIncomingMessage[], expandedMessages: Record<string, number> = {}) {
  const sessionId = "session-abc";
  const bridgeSession = {
    id: sessionId,
    messageHistory: history,
    state: { session_id: sessionId, expandedMessages },
  };
  const persistSessionById = vi.fn();
  const broadcastToSession = vi.fn();
  const api = new Hono();
  registerSessionExpandedMessagesRoute(api, {
    launcher: { getSession: vi.fn(() => ({ sessionId })) } as any,
    wsBridge: {
      getSession: vi.fn((id: string) => (id === sessionId ? bridgeSession : null)),
      persistSessionById,
      broadcastToSession,
    } as any,
    resolveId: vi.fn((raw: string) => (raw === sessionId || raw === "7" ? sessionId : null)),
  });
  const put = (messageId: string, body: unknown) =>
    api.request(`/sessions/7/expanded-messages/${encodeURIComponent(messageId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  return { put, bridgeSession, persistSessionById, broadcastToSession };
}

describe("session expanded messages route", () => {
  it("expands and collapses a report, saving and broadcasting the state", async () => {
    const { put, bridgeSession, persistSessionById, broadcastToSession } = makeRoute([user("u1"), report("r1")]);

    const expanded = await put("r1", { expanded: true });
    expect(expanded.status).toBe(200);
    expect(bridgeSession.state.expandedMessages).toEqual({ r1: expect.any(Number) });
    expect(persistSessionById).toHaveBeenCalledWith("session-abc");
    expect(broadcastToSession).toHaveBeenCalledWith("session-abc", {
      type: "session_update",
      session: { expandedMessages: { r1: expect.any(Number) } },
    });

    const collapsed = await put("r1", { expanded: false });
    expect((await collapsed.json()).expandedMessages).toEqual({});
    expect(broadcastToSession).toHaveBeenLastCalledWith("session-abc", {
      type: "session_update",
      session: { expandedMessages: {} },
    });
  });

  it("treats repeating the current state as a no-op", async () => {
    const { put, persistSessionById, broadcastToSession } = makeRoute([user("u1")], { u1: 5 });
    expect((await put("u1", { expanded: true })).status).toBe(200);
    expect((await put("other", { expanded: false })).status).toBe(200);
    expect(persistSessionById).not.toHaveBeenCalled();
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  it("rejects messages that are not in the history and malformed requests", async () => {
    const { put, bridgeSession } = makeRoute([user("u1")]);
    expect((await put("missing", { expanded: true })).status).toBe(400);
    expect((await put("u1", {})).status).toBe(400);
    expect(bridgeSession.state.expandedMessages).toEqual({});
  });

  it("keeps only the most recent expansions", async () => {
    // Expansions are never cleared by reading, so the record is bounded instead.
    const history = Array.from({ length: MAX_EXPANDED_MESSAGES + 1 }, (_, index) => user(`u${index}`));
    const existing = Object.fromEntries(
      Array.from({ length: MAX_EXPANDED_MESSAGES }, (_, index) => [`u${index}`, index + 1]),
    );
    const { put, bridgeSession } = makeRoute(history, existing);
    await put(`u${MAX_EXPANDED_MESSAGES}`, { expanded: true });
    const kept = bridgeSession.state.expandedMessages;
    expect(Object.keys(kept)).toHaveLength(MAX_EXPANDED_MESSAGES);
    expect(kept.u0).toBeUndefined();
    expect(kept[`u${MAX_EXPANDED_MESSAGES}`]).toBeDefined();
  });
});
