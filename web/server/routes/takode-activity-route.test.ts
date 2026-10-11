import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { RouteContext } from "./context.js";
import { registerTakodeActivityRoute } from "./takode-activity-route.js";

vi.mock("../tree-group-store.js", () => ({
  getState: vi.fn(async () => ({
    groups: [
      { id: "default", name: "Default" },
      { id: "g-takode", name: "Takode" },
      { id: "g-msi", name: "MSI" },
    ],
    assignments: {},
    nodeOrder: {},
  })),
}));
vi.mock("../session-names.js", () => ({ getName: vi.fn((sessionId: string) => `name-${sessionId}`) }));

interface FakeSession {
  sessionId: string;
  sessionNum: number;
  treeGroupId: string;
  history: BrowserIncomingMessage[];
  archived?: boolean;
  archivedAt?: number;
  searchDataOnly?: boolean;
  hidden?: boolean;
  sideChatOf?: string;
}

function ask(content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id: `m-${timestamp}`, content, timestamp } as BrowserIncomingMessage;
}

/** A route context over fake sessions; archived search-only sessions keep their history only in the store. */
function setup(sessions: FakeSession[], callerId: string | null, unreadable: string[] = []) {
  const load = vi.fn(async (sessionId: string) => {
    if (unreadable.includes(sessionId)) throw new Error("corrupt history");
    return { messageHistory: sessions.find((session) => session.sessionId === sessionId)!.history };
  });
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const ctx = {
    authenticateCompanionCallerOptional: () => (callerId ? { callerId, caller: {} } : null),
    launcher: {
      listSessions: () =>
        sessions.map((session) => ({
          sessionId: session.sessionId,
          archived: session.archived,
          archivedAt: session.archivedAt,
          hidden: session.hidden,
        })),
      getSession: (sessionId: string) => byId.get(sessionId),
      getSessionNum: (sessionId: string) => byId.get(sessionId)?.sessionNum,
    },
    wsBridge: {
      getSession: (sessionId: string) => {
        const session = byId.get(sessionId);
        if (!session) return undefined;
        return {
          searchDataOnly: session.searchDataOnly === true,
          messageHistory: session.searchDataOnly ? [] : session.history,
          state: {
            treeGroupId: session.treeGroupId,
            hidden: session.hidden,
            ...(session.sideChatOf ? { slackThreadChild: { rootSessionId: session.sideChatOf, threadId: "t1" } } : {}),
          },
        };
      },
    },
    sessionStore: { load },
  } as unknown as RouteContext;
  const api = new Hono();
  registerTakodeActivityRoute(api, ctx);
  const get = async (query: string, window = "since=0&until=10000") => {
    const response = await api.request(`/takode/activity?${window}${query}`);
    return { status: response.status, body: (await response.json()) as any };
  };
  return { get, load };
}

const sessionNums = (body: any) => body.threads.map((thread: any) => thread.session);

describe("GET /takode/activity", () => {
  const takode: FakeSession = {
    sessionId: "t",
    sessionNum: 1,
    treeGroupId: "g-takode",
    history: [ask("Takode work", 100)],
  };
  const msi: FakeSession = { sessionId: "m", sessionNum: 2, treeGroupId: "g-msi", history: [ask("MSI work", 200)] };

  it("limits a session caller to its own space unless it names spaces", async () => {
    // The default keeps one space's content out of another space's sessions.
    const { get } = setup([takode, msi], "t");
    expect(await get("")).toMatchObject({ status: 200, body: { spaces: ["Takode"] } });
    expect(sessionNums((await get("")).body)).toEqual([1]);
    expect(sessionNums((await get("&space=msi")).body)).toEqual([2]);
    expect(sessionNums((await get("&space=all")).body)).toEqual([1, 2]);
    expect(sessionNums((await get("&space=Takode,g-msi")).body)).toEqual([1, 2]);
  });

  it("covers every space for a caller outside any session, and rejects unknown spaces", async () => {
    const { get } = setup([takode, msi], null);
    expect((await get("")).body.spaces).toBeNull();
    expect(sessionNums((await get("")).body)).toEqual([1, 2]);
    const unknown = await get("&space=Nope");
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain('Unknown session space "Nope"');
  });

  it("loads archived history from disk only for sessions archived within the window", async () => {
    const recent: FakeSession = {
      sessionId: "a",
      sessionNum: 3,
      treeGroupId: "g-takode",
      history: [ask("Archived today", 300)],
      archived: true,
      archivedAt: 5000,
      searchDataOnly: true,
    };
    const old: FakeSession = { ...recent, sessionId: "o", sessionNum: 4, archivedAt: -1 };
    const { get, load } = setup([recent, old], null);
    expect(sessionNums((await get("")).body)).toEqual([3]);
    expect(load.mock.calls.map(([sessionId]) => sessionId)).toEqual(["a"]);
  });

  it("reports an archived session whose history cannot be read instead of failing or hiding it", async () => {
    const broken: FakeSession = {
      sessionId: "b",
      sessionNum: 8,
      treeGroupId: "g-takode",
      history: [],
      archived: true,
      archivedAt: 5000,
      searchDataOnly: true,
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { get } = setup([takode, broken], null, ["b"]);
    const { status, body } = await get("");
    warn.mockRestore();
    expect(status).toBe(200);
    expect(sessionNums(body)).toEqual([1]);
    expect(body.unreadable).toEqual([{ session: 8, error: "corrupt history" }]);
  });

  it("includes Side Chats in their root session's space but skips other hidden sessions", async () => {
    const sideChat: FakeSession = {
      sessionId: "s",
      sessionNum: 5,
      treeGroupId: "default",
      history: [ask("Side question", 400)],
      hidden: true,
      sideChatOf: "t",
    };
    const delegate: FakeSession = { ...sideChat, sessionId: "d", sessionNum: 6, sideChatOf: undefined };
    const { get } = setup([takode, sideChat, delegate], "t");
    const { body } = await get("");
    expect(sessionNums(body)).toEqual([1, 5]);
    expect(body.threads[1]).toMatchObject({ sessionName: "Side chat of #1", space: "Takode" });
  });

  it("rejects an empty or unreadable window", async () => {
    const { get } = setup([takode], null);
    expect((await get("", "since=500&until=500")).status).toBe(400);
    expect((await get("", "since=abc")).status).toBe(400);
  });
});
