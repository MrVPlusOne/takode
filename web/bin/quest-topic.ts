import type { QuestServerClient } from "./quest-server-client.js";
import type { TopicSummary } from "../shared/library-topics.js";

/**
 * `--topic` on `quest create` and `quest edit`: files the quest under a Library topic. A leader
 * with topics on that files a quest without one gets a reminder listing its space's topics.
 */
export async function fileQuestUnderTopic(server: QuestServerClient, questId: string, topic: string): Promise<void> {
  const { value } = await server.request<{ topic: TopicSummary; created: boolean }>("POST", "/topics/assign", {
    questId,
    topic,
  });
  console.log(`Filed under topic "${value.topic.name}"${value.created ? " (new)" : ""}.`);
}

export async function remindAboutTopic(server: QuestServerClient, questId: string): Promise<void> {
  const status = await server.read<{ enabled: boolean; topics: string[] }>("/topics/caller-status");
  if (!status?.enabled) return;
  const known = status.topics.slice(0, 25).map((name) => `"${name}"`);
  console.log(
    `Topics are on for you: file this quest with \`quest edit ${questId} --topic "<topic>"\`` +
      (known.length
        ? `, picking the closest existing topic; a new name starts a topic, for a genuinely new area only. Existing topics: ${known.join(", ")}.`
        : " (a new name starts a topic)."),
  );
}
