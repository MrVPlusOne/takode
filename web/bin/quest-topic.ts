import type { QuestServerClient } from "./quest-server-client.js";
import type { TopicSummary } from "../shared/library-topics.js";

/**
 * `--topic` on `quest create` and `quest edit`: files the quest under a Library topic. Leaders
 * usually leave it out: their Scribe files the quest (see `noteScribeFiles`).
 */
export async function fileQuestUnderTopic(server: QuestServerClient, questId: string, topic: string): Promise<void> {
  const { value } = await server.request<{ topic: TopicSummary; created: boolean }>("POST", "/topics/assign", {
    questId,
    topic,
  });
  console.log(`Filed under topic "${value.topic.name}"${value.created ? " (new)" : ""}. ${scopeLine(value.topic)}`);
}

/**
 * A topic's scope (its page's lead sentence), shown wherever a quest is filed so the filer sees at
 * once whether the quest belongs there.
 */
export function scopeLine(topic: Pick<TopicSummary, "summary">): string {
  return topic.summary ? `Its scope: ${topic.summary}` : "It has no scope line yet: its page isn't written.";
}

/**
 * A leader filed a quest without a topic: its Scribe files it, on its next update (Jiayi, Nov 1:
 * choosing a topic took the leader a lookup, and the Scribe focuses on this kind of work).
 */
export async function noteScribeFiles(server: QuestServerClient): Promise<void> {
  const status = await server.read<{ enabled: boolean }>("/topics/caller-status");
  if (status?.enabled) console.log("Your Scribe files it under a topic.");
}
