import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerSessionMessageSearchRoute } from "./session-message-search-route.js";
import type { BrowserIncomingMessage } from "../session-types.js";

function user(id: string, content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp };
}

function makeRoute(history: BrowserIncomingMessage[]) {
  const sessionId = "session-abc";
  const api = new Hono();
  registerSessionMessageSearchRoute(api, {
    launcher: {
      getSession: vi.fn(() => ({ sessionId, cwd: "/repo", createdAt: 1, isOrchestrator: false })),
      getSessionNum: vi.fn(() => 123),
    } as any,
    wsBridge: {
      getSession: vi.fn((id: string) =>
        id === sessionId ? { id, messageHistory: history, state: { isOrchestrator: false } } : null,
      ),
    } as any,
    resolveId: vi.fn((raw: string) => (raw === sessionId || raw === "123" ? sessionId : null)),
  });
  return api;
}

describe("GET /sessions/:id/message-search", () => {
  it("returns full-history message results with normalized filters and pagination", async () => {
    const app = makeRoute([
      user("old", "old persisted dragonfruit request", 10),
      user("new", "new visible request", 20),
    ]);

    const res = await app.request(
      "/sessions/123/message-search?q=dragon&scope=current_thread&includeUser=true&includeAssistant=false&limit=1",
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      sessionId: "session-abc",
      sessionNum: 123,
      query: "dragon",
      scope: { kind: "session", label: "Searching in session #123" },
      totalMatches: 1,
      hasMore: false,
      results: [
        {
          messageId: "old",
          historyIndex: 0,
          snippet: expect.stringContaining("dragonfruit"),
        },
      ],
    });
  });

  it("returns 404 for unknown sessions", async () => {
    const app = makeRoute([]);

    const res = await app.request("/sessions/missing/message-search");

    expect(res.status).toBe(404);
  });
});
