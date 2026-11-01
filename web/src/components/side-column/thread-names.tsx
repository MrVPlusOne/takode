import { useEffect } from "react";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { useStore } from "../../store.js";
import { loadLeaderNamesOnce, useKnownThreadOfKey, useKnownTopicOfKey } from "../../utils/leader-topics.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../../utils/thread-projection.js";

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

/** A thread by its name: Main, a quest's title, a thread's or topic's name ("Thread" until known). */
export function ThreadOriginName({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  return <>{useThreadPlace(leaderId, threadKey).name}</>;
}

/** Where a leader's message lives, named for the user: its conversation's key, name and kind. */
export interface ThreadPlace {
  /** The conversation to open: a thread that became a quest's thread, or joined an earlier one, is that one now. */
  key: string;
  name: string;
  kind: "main" | "quest" | "thread" | "topic";
}

/**
 * Names the conversation of a leader's thread key without ever showing the raw `topic:<handle>`
 * address: Main, a quest's title, a thread's or a topic's name ("Thread" until known). A thread
 * the Scribe joined onto an earlier one, or that became a quest's thread, is named and opened as
 * that conversation, where its messages are read now.
 */
export function useThreadPlace(leaderId: string, threadKey: string): ThreadPlace {
  const written = normalizeThreadKey(threadKey);
  const writtenThread = useKnownThreadOfKey(leaderId, isTopicViewKey(written) ? written : "");
  const key = normalizeThreadKey(writtenThread?.quest ?? writtenThread?.joinedInto ?? written);
  const topicKey = isTopicViewKey(key) ? key : "";
  const thread = useKnownThreadOfKey(leaderId, topicKey);
  const topic = useKnownTopicOfKey(leaderId, topicKey);
  const quest = key !== MAIN_THREAD_KEY && !topicKey;
  const questTitle = useStore((state) => (quest ? state.questTitlePreviews.get(key)?.title : undefined));
  const known = Boolean(thread || topic);
  useEffect(() => {
    if (quest && !questTitle) void useStore.getState().hydrateQuestTitles([key]);
  }, [key, quest, questTitle]);
  useEffect(() => {
    if (isTopicViewKey(written) && !known) loadLeaderNamesOnce(leaderId);
  }, [known, leaderId, written]);
  if (key === MAIN_THREAD_KEY) return { key, name: "Main", kind: "main" };
  if (quest) return { key, name: questTitle ?? key, kind: "quest" };
  if (topic && !thread) return { key, name: topic.name, kind: "topic" };
  return { key, name: thread?.name ?? "Thread", kind: "thread" };
}
