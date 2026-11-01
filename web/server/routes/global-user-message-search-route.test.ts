import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerGlobalUserMessageSearchRoute } from "./global-user-message-search-route.js";
import type { BrowserIncomingMessage } from "../session-types.js";

/**
 * GET /sessions/user-message-search reads every visible session: live ones from their history,
 * ones archived before the server started from their activity record (read from disk once).
 */

vi.mock("../tree-group-store.js", () => ({
  getState: vi.fn(async () => ({ groups: [], assignments: { "s-live": "work" }, nodeOrder: {} })),
}));

function user(id: string, content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp };
}

function makeApi() {
  const loadActivityRecord = vi.fn(async (sessionId: string) =>
    sessionId === "s-old"
      ? {
          version: 1 as const,
          isOrchestrator: false,
          asks: [{ index: 0, at: 5, text: "old dragonfruit idea", thread: "main" }],
          answers: [],
          unrequested: [],
        }
      : null,
  );
  const sessions: Record<string, unknown> = {
    "s-live": { state: {}, messageHistory: [user("live", "fresh dragonfruit note", 10)] },
    "s-old": {
      state: {},
      searchDataOnly: true,
      messageHistory: [],
      searchExcerpts: [{ type: "user_message", id: "old", content: "old dragonfruit idea", timestamp: 5 }],
    },
    "s-hidden": { state: { hidden: true }, messageHistory: [user("hidden", "dragonfruit from a delegate", 20)] },
  };
  const api = new Hono();
  registerGlobalUserMessageSearchRoute(api, {
    launcher: {
      listSessions: vi.fn(() => [
        { sessionId: "s-live", sessionNum: 1, name: "Live" },
        { sessionId: "s-old", sessionNum: 2, name: "Old", archived: true },
        { sessionId: "s-hidden", sessionNum: 3 },
      ]),
      getSessionNum: vi.fn(() => undefined),
    } as any,
    wsBridge: { getSession: vi.fn((sessionId: string) => sessions[sessionId] ?? null) } as any,
    sessionStore: { loadActivityRecord },
  });
  return { api, loadActivityRecord };
}

describe("GET /sessions/user-message-search", () => {
  it("searches live and archived sessions, reading each archived record once", async () => {
    const { api, loadActivityRecord } = makeApi();

    const body = await (await api.request("/sessions/user-message-search?q=dragonfruit")).json();
    expect(body.results.map((result: any) => [result.sessionId, result.messageId, result.archived])).toEqual([
      ["s-live", "live", false],
      ["s-old", "old", true],
    ]);
    expect(body.results[0]).toMatchObject({ sessionNum: 1, sessionName: "Live" });

    await api.request("/sessions/user-message-search?q=idea");
    expect(loadActivityRecord).toHaveBeenCalledTimes(1);
  });

  it("keeps to one session space when asked", async () => {
    const { api } = makeApi();
    const body = await (await api.request("/sessions/user-message-search?q=dragonfruit&sessionSpaceId=work")).json();
    expect(body.results.map((result: any) => result.sessionId)).toEqual(["s-live"]);
  });
});
