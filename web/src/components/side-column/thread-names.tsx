import { useKnownThreadOfKey, useKnownTopicOfKey } from "../../utils/leader-topics.js";
import { useQuestRecord } from "../QuestSummaryCard.js";

/** A provisional name: the message's first words, until the leader names the thread. */
export function threadNameFromMessage(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) =>
        part
          .replace(/[#>*_`[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "";
  if (!line) return "New thread";
  const words = line.split(" ");
  let name = "";
  for (const word of words) {
    if ((name + " " + word).trim().length > 48) break;
    name = (name + " " + word).trim();
  }
  if (!name) name = line.slice(0, 48);
  return name.length < line.length ? `${name}…` : name;
}

/** A thread by its name: a quest's title, a topic's name (its key until known). */
export function ThreadOriginName({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  const isQuest = /^q-\d+$/i.test(threadKey);
  const quest = useQuestRecord(isQuest ? threadKey : null);
  const topic = useKnownTopicOfKey(leaderId, isQuest ? "" : threadKey);
  const thread = useKnownThreadOfKey(leaderId, isQuest ? "" : threadKey);
  return <>{(isQuest ? quest?.title : (thread?.name ?? topic?.name)) ?? threadKey}</>;
}
