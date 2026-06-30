import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerGlobalStarredMessageSearchRoute } from "./global-starred-message-search-route.js";
import type { BrowserIncomingMessage, StarredMessageRecord } from "../session-types.js";

function user(id: string, content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp };
}

function star(messageId: string, historyIndex: number, timestamp: number, starredAt: number): StarredMessageRecord {
  return {
    messageId,
    role: "user",
    historyIndex,
    sourceThreadKey: "main",
    routeThreadKey: "main",
    timestamp,
    starredAt,
  };
}

describe("GET /sessions/starred-message-search", () => {
  it("searches stable starred targets across archived and reviewer sessions", async () => {
    const api = new Hono();
    registerGlobalStarredMessageSearchRoute(api, {
      launcher: {
        listSessions: vi.fn(() => [
          {
            sessionId: "s-worker",
            sessionNum: 10,
            state: "connected",
            cwd: "/worker",
            createdAt: 1,
            archived: false,
            name: "Worker",
          },
          {
            sessionId: "s-reviewer",
            sessionNum: 11,
            state: "exited",
            cwd: "/review",
            createdAt: 2,
            archived: true,
            archivedAt: 123,
            reviewerOf: 10,
            name: "Reviewer",
          },
        ]),
        getSessionNum: vi.fn((sessionId: string) => (sessionId === "s-worker" ? 10 : 11)),
      } as any,
      wsBridge: {
        getSession: vi.fn((sessionId: string) => {
          if (sessionId === "s-worker") {
            return {
              state: { session_id: sessionId, starredMessages: { worker: star("worker", 0, 10, 100) } },
              messageHistory: [user("worker", "worker dragonfruit note", 10)],
              searchExcerpts: [],
            };
          }
          if (sessionId === "s-reviewer") {
            return {
              state: { session_id: sessionId, starredMessages: { reviewer: star("reviewer", 0, 20, 200) } },
              messageHistory: [],
              searchExcerpts: [
                { type: "user_message", id: "reviewer", content: "archived reviewer dragonfruit note", timestamp: 20 },
              ],
            };
          }
          return null;
        }),
      } as any,
    });

    const res = await api.request("/sessions/starred-message-search?limit=10");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalMatches).toBe(2);
    expect(body.results.map((result: any) => result.sessionId)).toEqual(["s-reviewer", "s-worker"]);
    expect(body.results[0]).toMatchObject({
      sessionId: "s-reviewer",
      archived: true,
      reviewerOf: 10,
      starredAt: 200,
      routeThreadKey: "main",
    });
  });
});
