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
        id === sessionId
          ? {
              id,
              messageHistory: history,
              state: {
                isOrchestrator: false,
                starredMessages: {
                  old: {
                    messageId: "old",
                    role: "user",
                    historyIndex: 0,
                    sourceThreadKey: "main",
                    routeThreadKey: "main",
                    timestamp: 10,
                    starredAt: 100,
                  },
                },
              },
            }
          : null,
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
      "/sessions/123/message-search?q=dragon&scope=current_thread&includeUser=true&includeAssistant=false&starredOnly=true&limit=1",
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
          starred: true,
          snippet: expect.stringContaining("dragonfruit"),
        },
      ],
    });
  });

  it("orders matches newest first with sort=recent", async () => {
    // Exact-word "relay" in the older message outranks the newer prefix match by relevance.
    const app = makeRoute([user("exact-old", "relay down", 10), user("prefix-new", "relaying again", 20)]);
    const ids = async (url: string) =>
      ((await (await app.request(url)).json()) as { results: Array<{ messageId: string }> }).results.map(
        (result) => result.messageId,
      );
    expect(await ids("/sessions/123/message-search?q=relay&includeUser=true")).toEqual(["exact-old", "prefix-new"]);
    expect(await ids("/sessions/123/message-search?q=relay&includeUser=true&sort=recent")).toEqual([
      "prefix-new",
      "exact-old",
    ]);
  });

  // The navigator re-reads this index on every switch; its timing field differs
  // on every run, so the validator must ignore it for an unchanged index to be a 304.
  it("answers an unchanged index with a 304 despite a different run time", async () => {
    const history = [user("old", "first request", 10)];
    const app = makeRoute(history);
    const url = "/sessions/123/message-search?scope=current_thread&includeUser=true";
    const first = await app.request(url);
    const etag = first.headers.get("etag")!;
    expect(first.headers.get("cache-control")).toBe("private, no-cache");

    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);
    const again = await app.request(url, { headers: { "if-none-match": etag } });
    now.mockRestore();
    expect(again.status).toBe(304);

    history.push(user("new", "second request", 20));
    const changed = await app.request(url, { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
    expect((await changed.json()).totalMatches).toBe(2);
  });

  it("returns 404 for unknown sessions", async () => {
    const app = makeRoute([]);

    const res = await app.request("/sessions/missing/message-search");

    expect(res.status).toBe(404);
  });
});

it("returns one source target without message content and rejects unavailable targets", async () => {
  const app = makeRoute([
    {
      type: "assistant",
      message: {
        id: "source",
        type: "message",
        role: "assistant",
        model: "claude",
        content: [{ type: "text", text: "Full source text" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      parent_tool_use_id: null,
      timestamp: 1,
    } as BrowserIncomingMessage,
  ]);
  const response = await app.request("/sessions/123/message-target/source");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ messageId: "source", threadKey: "main" });
  expect((await app.request("/sessions/123/message-target/missing")).status).toBe(404);
  expect((await app.request("/sessions/missing/message-target/source")).status).toBe(404);
});
