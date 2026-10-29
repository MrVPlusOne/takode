import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { QuestmasterTask } from "../quest-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { OptionalAuthResult } from "./context.js";
import { registerStartedQuestsRoute, resolveQuestStartedFrom } from "./quest-started-from.js";

/** A user's message to a leader as the bridge records it: written in `threadKey`. */
function human(id: string, leaderUserMessageId: string, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: `message ${id}`,
    timestamp: 1_000 + Number(leaderUserMessageId.slice(1)),
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
  } as BrowserIncomingMessage;
}

const HISTORY = [human("msg-a", "u1"), human("msg-b", "u2", "q-7")];
const LEADER_AUTH = { callerId: "leader-1", caller: {} } as OptionalAuthResult;

describe("resolveQuestStartedFrom", () => {
  const history = (sessionId: string) => (sessionId === "leader-1" ? HISTORY : undefined);

  it("records the user's message, its thread and time from the caller's own uN ID", () => {
    // `quest create --source-message u2` from leader-1 names msg-b, written in q-7.
    expect(resolveQuestStartedFrom(LEADER_AUTH, "u2", history)).toEqual({
      startedFrom: { sessionId: "leader-1", messageId: "msg-b", threadKey: "q-7", timestamp: 1_002 },
    });
    expect(resolveQuestStartedFrom(LEADER_AUTH, "u1", history)).toMatchObject({
      startedFrom: { messageId: "msg-a", threadKey: "main" },
    });
  });

  it("does nothing when no source message was named", () => {
    expect(resolveQuestStartedFrom(LEADER_AUTH, undefined, history)).toBeNull();
  });

  it("refuses an unknown ID or a caller without a session, since uN IDs are per session", () => {
    expect(resolveQuestStartedFrom(LEADER_AUTH, "u9", history)).toEqual({
      error: "No user message u9 in this session",
    });
    expect(resolveQuestStartedFrom(null, "u1", history)).toHaveProperty("error");
  });
});

describe("GET /sessions/:id/started-quests", () => {
  it("lists only the quests started from that session's messages", async () => {
    const quest = (questId: string, sessionId?: string) =>
      ({
        questId,
        title: `Title ${questId}`,
        ...(sessionId
          ? {
              relationships: {
                startedFrom: { sessionId, messageId: `m-${questId}`, threadKey: "main", timestamp: 5 },
              },
            }
          : {}),
      }) as QuestmasterTask;
    const api = new Hono();
    registerStartedQuestsRoute(api, {
      resolveId: (id) => (id === "12" ? "leader-1" : id),
      listQuests: async () => [quest("q-1", "leader-1"), quest("q-2", "leader-2"), quest("q-3")],
      getQuest: async () => null,
      getHistory: () => [],
    });

    const response = await api.request("/sessions/12/started-quests");
    expect(await response.json()).toEqual({
      quests: [
        {
          questId: "q-1",
          title: "Title q-1",
          startedFrom: { sessionId: "leader-1", messageId: "m-q-1", threadKey: "main", timestamp: 5 },
          // Its source message is not in the (empty) history, so it cannot be a side quest.
          sideQuest: false,
        },
      ],
    });
  });

  it("links a request handed off to a quest (also a reopened one), not only quests filed from it", async () => {
    // Jiayi: a request filed as a new quest showed "Continued in q-N", but one handed off to a
    // reopened quest (takode thread handoff) showed no quest. A quest has one startedFrom, so
    // handoffs are read from the requests' own ownership refs; past handoffs show too.
    const handedOff = {
      ...human("msg-c", "u3"),
      threadRefs: [{ threadKey: "q-44", questId: "q-44", source: "explicit", attachedAt: 2_000 }],
    } as BrowserIncomingMessage;
    const filedAndHandedOff = {
      ...human("msg-d", "u4"),
      threadRefs: [{ threadKey: "q-45", questId: "q-45", source: "explicit", attachedAt: 2_000 }],
    } as BrowserIncomingMessage;
    const attachedOnly = {
      ...human("msg-e", "u5"),
      threadRefs: [{ threadKey: "q-44", questId: "q-44", source: "backfill", attachedAt: 2_000 }],
    } as BrowserIncomingMessage;
    const api = new Hono();
    registerStartedQuestsRoute(api, {
      resolveId: (id) => id,
      listQuests: async () =>
        [
          // Reopened quest: filed long ago from another message.
          {
            questId: "q-44",
            title: "Quest views",
            relationships: {
              startedFrom: { sessionId: "leader-1", messageId: "msg-a", threadKey: "main", timestamp: 1 },
            },
          },
          {
            questId: "q-45",
            title: "Changelog",
            relationships: {
              startedFrom: { sessionId: "leader-1", messageId: "msg-d", threadKey: "main", timestamp: 1 },
            },
          },
        ] as unknown as QuestmasterTask[],
      getQuest: async () => null,
      getHistory: () => [...HISTORY, handedOff, filedAndHandedOff, attachedOnly],
    });
    const { quests } = (await (await api.request("/sessions/leader-1/started-quests")).json()) as {
      quests: Array<{ questId: string; startedFrom: { messageId: string; threadKey: string }; sideQuest: boolean }>;
    };
    expect(quests.map((quest) => `${quest.startedFrom.messageId}->${quest.questId}`)).toEqual([
      "msg-a->q-44",
      "msg-d->q-45",
      // The handoff into the reopened quest; the filed-and-handed-off one is not listed twice,
      // and context attached with thread attach (backfill) is not quest work.
      "msg-c->q-44",
    ]);
    expect(quests[2]).toMatchObject({ startedFrom: { threadKey: "main" }, sideQuest: false });
  });

  it("returns the answer that delivered a supporting quest's result", async () => {
    // u3 was asked in q-10 and stayed there; q-11 was filed from it, and the leader
    // answered u3 in q-10 in the turn the worker's herd event started.
    const leaderHistory = [
      { ...human("ask", "u3", "q-10"), timestamp: 1000 },
      {
        type: "user_message",
        id: "herd",
        content: "1 event from 1 session",
        timestamp: 4000,
        agentSource: { sessionId: "herd-events" },
        threadKey: "q-11",
        questId: "q-11",
      },
      {
        type: "assistant",
        message: { id: "answer", content: [{ type: "text", text: "Both checks agree." }] },
        parent_tool_use_id: null,
        timestamp: 4100,
        threadKey: "q-10",
        questId: "q-10",
        threadAnswer: { version: 2, answerUserMessageIds: ["u3"], observedHistoryLength: 1, authoredThreadKey: "q-10" },
      },
    ] as unknown as BrowserIncomingMessage[];
    const supportingQuest = {
      questId: "q-11",
      title: "Condor check",
      createdAt: 1500,
      relationships: { startedFrom: { sessionId: "leader-1", messageId: "ask", threadKey: "q-10", timestamp: 1000 } },
    } as QuestmasterTask;
    const api = new Hono();
    registerStartedQuestsRoute(api, {
      resolveId: (id) => id,
      listQuests: async () => [supportingQuest],
      getQuest: async (questId) => (questId === "q-11" ? supportingQuest : null),
      getHistory: () => leaderHistory,
    });

    expect(await (await api.request("/sessions/leader-1/started-quests/q-11/answer")).json()).toEqual({
      answer: { messageId: "answer", threadKey: "q-10", timestamp: 4100, markdown: "Both checks agree." },
    });
    expect((await api.request("/sessions/leader-1/started-quests/q-99/answer")).status).toBe(404);
  });
});
