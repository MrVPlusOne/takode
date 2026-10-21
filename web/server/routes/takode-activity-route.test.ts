import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { buildSessionActivityRecord, type SessionActivityRecord } from "../activity-stream.js";
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
function setup(
  sessions: FakeSession[],
  callerId: string | null,
  unreadable: string[] = [],
  records = new Map<string, SessionActivityRecord>(),
) {
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
    sessionStore: {
      load,
      loadActivityRecord: vi.fn(async (sessionId: string) => records.get(sessionId) ?? null),
      saveActivityRecord: vi.fn(async (sessionId: string, record: SessionActivityRecord) => {
        records.set(sessionId, record);
      }),
    },
  } as unknown as RouteContext;
  const api = new Hono();
  registerTakodeActivityRoute(api, ctx);
  const get = async (query: string, window = "since=0&until=10000") => {
    const response = await api.request(`/takode/activity?${window}${query}`);
    return { status: response.status, body: (await response.json()) as any };
  };
  return { get, load, records };
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

  it("reads an archived session's saved activity record instead of its history", async () => {
    // The record saved at archive time holds everything the stream lists, so nothing is read from disk.
    const archived: FakeSession = {
      sessionId: "a",
      sessionNum: 3,
      treeGroupId: "g-takode",
      history: [ask("Archived today", 300)],
      archived: true,
      archivedAt: 5000,
      searchDataOnly: true,
    };
    const records = new Map([["a", buildSessionActivityRecord(archived.history, false)]]);
    const { get, load } = setup([archived], null, [], records);
    const { body } = await get("");
    expect(body.threads[0].messages.map((message: { text: string }) => message.text)).toEqual(["Archived today"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("saves the record of an archived session that had none, so its history is read only once", async () => {
    const archived: FakeSession = {
      sessionId: "a",
      sessionNum: 3,
      treeGroupId: "g-takode",
      history: [ask("Archived before records existed", 300)],
      archived: true,
      archivedAt: 5000,
      searchDataOnly: true,
    };
    const { get, load, records } = setup([archived], null);
    const first = await get("");
    const second = await get("");
    expect(second.body).toEqual(first.body);
    expect(load).toHaveBeenCalledTimes(1);
    expect(records.has("a")).toBe(true);
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

  it("cuts each message to 1,000 characters by default and returns whole messages with full=1", async () => {
    // The user chose 1,000 characters: enough for most answers' substance at a moderate daily token cost.
    const long: FakeSession = { ...takode, history: [ask("x".repeat(1500), 100)] };
    const { get } = setup([long], null);
    const cut = (await get("")).body.threads[0].messages[0];
    expect(cut).toMatchObject({ text: `${"x".repeat(1000)}…`, chars: 1500 });
    const whole = (await get("&full=1")).body.threads[0].messages[0];
    expect(whole.text).toHaveLength(1500);
    expect(whole.chars).toBeUndefined();
  });

  it("rejects an empty or unreadable window", async () => {
    const { get } = setup([takode], null);
    expect((await get("", "since=500&until=500")).status).toBe(400);
    expect((await get("", "since=abc")).status).toBe(400);
  });
});
