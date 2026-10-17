/**
 * Links between the two ends of a conversation fork: a quest filed from one of the user's
 * messages opens its thread with "Started from your message in …", and that message gets
 * "Continued in …" links to the quests it started. The user can then follow a
 * conversation that moved to another tab from either end.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { QuestStartedFrom } from "../../server/quest-types.js";
import { fetchStartedQuests, type StartedQuest } from "../api/started-quests.js";
import { useStore } from "../store.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { formatMessageTimestamp } from "./MessageTimestamp.js";

/** The quests started from each user message, by message ID; the Playground provides fixed ones. */
export const StartedQuestsContext = createContext<ReadonlyMap<string, StartedQuest[]> | null>(null);

/**
 * Loads the quests started from this leader's messages for the feed below. `refreshKey`
 * reloads them; pass something that changes when new quest threads appear.
 */
export function StartedQuestsProvider({
  sessionId,
  enabled,
  refreshKey,
  children,
}: {
  sessionId: string;
  enabled: boolean;
  refreshKey: string | number;
  children: ReactNode;
}) {
  const [quests, setQuests] = useState<StartedQuest[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchStartedQuests(sessionId, controller.signal)
      .then(setQuests)
      .catch((error) => {
        if (!controller.signal.aborted) console.error("[quest-forks] Started quests failed to load:", error);
      });
    return () => controller.abort();
  }, [enabled, sessionId, refreshKey]);
  const byMessageId = useMemo(() => {
    const map = new Map<string, StartedQuest[]>();
    for (const quest of enabled ? quests : []) {
      const list = map.get(quest.startedFrom.messageId) ?? [];
      list.push(quest);
      map.set(quest.startedFrom.messageId, list);
    }
    return map;
  }, [enabled, quests]);
  return <StartedQuestsContext.Provider value={byMessageId}>{children}</StartedQuestsContext.Provider>;
}

/** Under a user's message: the quests it started, except the one whose thread is on screen. */
export function ContinuedInLinks({
  messageId,
  currentThreadKey,
  onSelectThread,
}: {
  messageId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
}) {
  const quests = useContext(StartedQuestsContext)?.get(messageId);
  const current = currentThreadKey ? normalizeThreadKey(currentThreadKey) : null;
  const shown = quests?.filter((quest) => normalizeThreadKey(quest.questId) !== current) ?? [];
  if (!onSelectThread || shown.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col items-end gap-0.5" data-testid="continued-in-links">
      {shown.map((quest) => (
        <button
          key={quest.questId}
          type="button"
          onClick={() => onSelectThread(normalizeThreadKey(quest.questId))}
          className="inline-flex max-w-full items-center gap-0.5 whitespace-pre text-[12px] text-cc-muted hover:text-cc-fg"
          data-testid="continued-in-link"
          data-quest-id={quest.questId}
        >
          <span className="shrink-0">Continued in </span>
          <span className="min-w-0 truncate text-cc-primary">{quest.title}</span>
          <ArrowGlyph />
        </button>
      ))}
    </div>
  );
}

/** Opens a quest thread with a link back to the user's message the quest was filed from. */
export function StartedFromLink({ startedFrom, sessionId }: { startedFrom: QuestStartedFrom; sessionId?: string }) {
  const threadKey = normalizeThreadKey(startedFrom.threadKey);
  const main = threadKey === MAIN_THREAD_KEY;
  const questTitle = useStore((state) => (main ? undefined : state.questTitlePreviews.get(threadKey)?.title));
  useEffect(() => {
    if (!main && !questTitle) void useStore.getState().hydrateQuestTitles([threadKey]);
  }, [main, questTitle, threadKey]);
  // Quests filed in another leader's conversation name that leader.
  const otherSessionNum = useStore((state) =>
    sessionId && sessionId !== startedFrom.sessionId
      ? state.sdkSessions.find((session) => session.sessionId === startedFrom.sessionId)?.sessionNum
      : undefined,
  );
  const place = `${otherSessionNum != null ? `#${otherSessionNum} ` : ""}${main ? "Main" : (questTitle ?? threadKey)}`;
  const time = formatMessageTimestamp(startedFrom.timestamp);
  return (
    <button
      type="button"
      onClick={() =>
        navigateToSessionMessageId(startedFrom.sessionId, startedFrom.messageId, {
          threadKey,
          preserveMainThreadRoute: true,
        })
      }
      className="ml-9 mb-2 flex max-w-full items-center gap-0.5 whitespace-pre text-left text-[12px] text-cc-muted hover:text-cc-fg"
      data-testid="started-from-link"
    >
      <span className="shrink-0">Started from your message in </span>
      <span className="min-w-0 truncate text-cc-primary">{place}</span>
      {time && <span className="shrink-0"> · {time}</span>}
      <ArrowGlyph />
    </button>
  );
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
