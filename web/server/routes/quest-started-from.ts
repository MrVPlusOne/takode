import type { Hono } from "hono";
import {
  leaderMessageThreadKey,
  leaderResponseOriginalThreadKey,
  leaderResponseOwnerThreadKey,
} from "../../shared/leader-thread-response-routing.js";
import { buildLeaderUserMessageIdentities, findLeaderUserMessageById } from "../leader-user-message-id.js";
import type { QuestStartedFrom, QuestmasterTask } from "../quest-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import {
  findSupportingQuestAnswer,
  findSupportingQuestSource,
  indexLeaderRequests,
  type LeaderRequestIndex,
} from "../supporting-quest.js";
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
  /** Whether it is a side (supporting) quest now; see findSupportingQuestSource. */
  sideQuest: boolean;
}

/**
 * `GET /sessions/:id/started-quests`: the quests filed from the user's messages in one
 * leader session, so each source message can link on to the quest it started.
 * `GET /sessions/:id/started-quests/:questId/answer`: for a supporting quest, the leader's
 * answer that delivered its result, so the quest's own thread can show it.
 */
export function registerStartedQuestsRoute(
  api: Hono,
  deps: {
    resolveId: (idOrNum: string) => string | null;
    listQuests: () => Promise<ReadonlyArray<QuestmasterTask>>;
    getQuest: (questId: string) => Promise<QuestmasterTask | null>;
    getHistory: (sessionId: string) => ReadonlyArray<BrowserIncomingMessage> | undefined;
  },
): void {
  api.get("/sessions/:id/started-quests", async (c) => {
    const sessionId = deps.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const quests: StartedQuest[] = [];
    let requests: LeaderRequestIndex | null = null;
    const allQuests = await deps.listQuests();
    for (const quest of allQuests) {
      const startedFrom = quest.relationships?.startedFrom;
      if (startedFrom?.sessionId !== sessionId) continue;
      requests ??= indexLeaderRequests(deps.getHistory(sessionId) ?? []);
      const sideQuest = !!findSupportingQuestSource(requests, sessionId, quest.questId, startedFrom);
      quests.push({ questId: quest.questId, title: quest.title, startedFrom, sideQuest });
    }
    quests.push(...handedOffRequests(sessionId, deps.getHistory(sessionId) ?? [], allQuests, quests));
    return c.json({ quests });
  });

  api.get("/sessions/:id/started-quests/:questId/answer", async (c) => {
    const sessionId = deps.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const quest = await deps.getQuest(c.req.param("questId").toLowerCase());
    if (!quest) return c.json({ error: "Quest not found" }, 404);
    const history = deps.getHistory(sessionId) ?? [];
    const startedFrom = quest.relationships?.startedFrom;
    const source = findSupportingQuestSource(indexLeaderRequests(history), sessionId, quest.questId, startedFrom);
    const answer = source ? findSupportingQuestAnswer(history, source, quest.questId, quest.createdAt) : null;
    return c.json({ answer });
  });
}

/**
 * Requests that became quest work by a handoff (`takode thread handoff`, also into a reopened
 * quest) rather than by filing a quest from them: each shows "Continued in" its quest like a quest
 * filed from it. A quest has one `startedFrom`, so a reopened quest's later requests would
 * otherwise show no quest at all. Read from the requests' ownership refs, so past handoffs show too.
 */
function handedOffRequests(
  sessionId: string,
  history: ReadonlyArray<BrowserIncomingMessage>,
  allQuests: ReadonlyArray<QuestmasterTask>,
  filed: ReadonlyArray<StartedQuest>,
): StartedQuest[] {
  const titles = new Map(allQuests.map((quest) => [quest.questId, quest.title]));
  const listed = new Set(filed.map((quest) => `${quest.startedFrom.messageId}:${quest.questId}`));
  const found: StartedQuest[] = [];
  for (const { historyMessageId, message } of buildLeaderUserMessageIdentities(history)) {
    const owner = leaderResponseOwnerThreadKey(message);
    // Where it was written: its own route (Main for a message stored without one).
    const written = leaderResponseOriginalThreadKey(message) ?? "main";
    if (!owner || !/^q-\d+$/.test(owner) || owner === written) continue;
    const title = titles.get(owner);
    if (title === undefined || listed.has(`${historyMessageId}:${owner}`)) continue;
    found.push({
      questId: owner,
      title,
      startedFrom: { sessionId, messageId: historyMessageId, threadKey: written, timestamp: message.timestamp },
      sideQuest: false,
    });
  }
  return found;
}
