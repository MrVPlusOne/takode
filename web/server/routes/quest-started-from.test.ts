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
    });

    const response = await api.request("/sessions/12/started-quests");
    expect(await response.json()).toEqual({
      quests: [
        {
          questId: "q-1",
          title: "Title q-1",
          startedFrom: { sessionId: "leader-1", messageId: "m-q-1", threadKey: "main", timestamp: 5 },
        },
      ],
    });
  });
});
