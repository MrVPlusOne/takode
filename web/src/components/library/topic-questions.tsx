import { useCallback, useMemo } from "react";
import { useGlobalNeedsInputEntries } from "../../hooks/useGlobalNeedsInputEntries.js";
import type { GlobalNeedsInputEntry } from "../../utils/global-needs-input.js";
import { navigateToNotification } from "../../utils/notification-navigation.js";
import { resolveNotificationOwnerThreadKey } from "../../utils/notification-thread.js";

/**
 * What waits on the user in a topic: the open questions of its quests. They are the needs-input
 * notifications the top bar's question list shows (asked to the user, not muted, not answered),
 * read from the same entries, so a topic shows one as soon as it is asked and drops it once it is
 * answered. The question list stays the place to answer; a topic only points to its questions.
 */

/** The open questions of a set of quests, newest first. */
export type TopicQuestions = (questIds: readonly string[]) => GlobalNeedsInputEntry[];

/** Looks up the open questions of a topic's quests, and opens one where it was asked. */
export function useTopicQuestions(): {
  questionsOf: TopicQuestions;
  openQuestion: (entry: GlobalNeedsInputEntry) => void;
} {
  const { entries, sdkSessions } = useGlobalNeedsInputEntries();
  const byQuest = useMemo(() => {
    const map = new Map<string, GlobalNeedsInputEntry[]>();
    for (const entry of entries) {
      const questId = questOf(entry);
      if (questId) map.set(questId, [...(map.get(questId) ?? []), entry]);
    }
    return map;
  }, [entries]);
  const questionsOf = useCallback<TopicQuestions>(
    (questIds) =>
      questIds
        .flatMap((questId) => byQuest.get(questId) ?? [])
        .sort((a, b) => b.notification.timestamp - a.notification.timestamp),
    [byQuest],
  );
  const openQuestion = useCallback(
    (entry: GlobalNeedsInputEntry) => navigateToNotification(entry.sessionId, entry.notification, sdkSessions),
    [sdkSessions],
  );
  return { questionsOf, openQuestion };
}

/** The quest a question belongs to: the quest thread it was asked in, else the quest it names. */
export function questOf(entry: GlobalNeedsInputEntry): string | null {
  const threadKey = resolveNotificationOwnerThreadKey(entry.notification);
  if (/^q-\d+$/.test(threadKey)) return threadKey;
  return entry.notification.questId ?? null;
}

/** "1 question for you" in amber; tapping it opens the newest. Nothing when there are none. */
export function TopicQuestionsBadge({
  questions,
  onOpen,
  className = "",
}: {
  questions: GlobalNeedsInputEntry[];
  onOpen: (entry: GlobalNeedsInputEntry) => void;
  className?: string;
}) {
  const newest = questions[0];
  if (!newest) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(newest)}
      className={`flex items-center gap-1.5 text-left text-[12.5px] text-[var(--color-cc-phase-accent-amber)] hover:underline ${className}`}
      title={questionText(newest)}
      data-testid="topic-questions-badge"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-cc-phase-accent-amber)]" />
      {questions.length} {questions.length === 1 ? "question" : "questions"} for you
    </button>
  );
}

/** The words of a question, for lists: its summary, else its first prompt. */
export function questionText(entry: GlobalNeedsInputEntry): string {
  const { summary, questions } = entry.notification;
  return summary?.trim() || questions?.[0]?.prompt.trim() || "A question for you";
}
