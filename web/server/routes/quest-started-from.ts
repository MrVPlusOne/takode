import type { Hono } from "hono";
import { leaderMessageThreadKey } from "../../shared/leader-thread-response-routing.js";
import { findLeaderUserMessageById } from "../leader-user-message-id.js";
import type { QuestStartedFrom, QuestmasterTask } from "../quest-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { OptionalAuthResult } from "./context.js";

/**
 * Resolve the `uN` ID a leader names when filing a quest from a conversation
 * (`quest create --source-message uN`) into the user's message in that leader's history.
 * The ID is scoped to the calling session, so the caller must be a Takode session.
 */
export function resolveQuestStartedFrom(
  auth: OptionalAuthResult,
  userMessageId: unknown,
  getHistory: (sessionId: string) => ReadonlyArray<BrowserIncomingMessage> | undefined,
): { startedFrom: QuestStartedFrom } | { error: string } | null {
  if (userMessageId === undefined) return null;
  const id = typeof userMessageId === "string" ? userMessageId.trim() : "";
  if (!auth || "response" in auth) {
    return { error: "--source-message needs a Takode session: its uN IDs belong to the session that received them" };
  }
  const entry = findLeaderUserMessageById(getHistory(auth.callerId) ?? [], id);
  if (!entry) return { error: `No user message ${id || "(empty)"} in this session` };
  return {
    startedFrom: {
      sessionId: auth.callerId,
      messageId: entry.historyMessageId,
      threadKey: leaderMessageThreadKey(entry.message),
      timestamp: entry.message.timestamp,
    },
  };
}

/** A quest filed from a user's message in a leader session. */
export interface StartedQuest {
  questId: string;
  title: string;
  startedFrom: QuestStartedFrom;
}

/**
 * `GET /sessions/:id/started-quests`: the quests filed from the user's messages in one
 * leader session, so each source message can link on to the quest it started.
 */
export function registerStartedQuestsRoute(
  api: Hono,
  deps: {
    resolveId: (idOrNum: string) => string | null;
    listQuests: () => Promise<ReadonlyArray<QuestmasterTask>>;
  },
): void {
  api.get("/sessions/:id/started-quests", async (c) => {
    const sessionId = deps.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const quests: StartedQuest[] = [];
    for (const quest of await deps.listQuests()) {
      const startedFrom = quest.relationships?.startedFrom;
      if (startedFrom?.sessionId !== sessionId) continue;
      quests.push({ questId: quest.questId, title: quest.title, startedFrom });
    }
    return c.json({ quests });
  });
}
