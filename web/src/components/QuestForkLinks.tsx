/**
 * Links between the two ends of a conversation fork: a quest filed from one of the user's
 * messages opens its thread with "Started from your message in …", and that message gets
 * "Continued in …" links to the quests it started. The user can then follow a
 * conversation that moved to another tab from either end.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { QuestStartedFrom } from "../../server/quest-types.js";
import { getQuestJourneyPhaseForState, getQuestJourneyPresentation } from "../../shared/quest-journey.js";
import { fetchStartedQuests, type StartedQuest } from "../api/started-quests.js";
import { useStore } from "../store.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { getQuestPhaseDotStyle } from "../utils/quest-phase-theme.js";
import { formatMessageTimestamp } from "./MessageTimestamp.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

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
      {shown.map((quest) =>
        quest.supporting ? (
          <SupportingQuestLink key={quest.questId} quest={quest} />
        ) : (
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
        ),
      )}
    </div>
  );
}

/**
 * A supporting quest under the request it helps answer: its current phase and title.
 * The request stays here and is answered here, so the title previews the quest in place
 * (a tap, or the eye on desktop) instead of switching to the quest's tab.
 */
function SupportingQuestLink({ quest }: { quest: StartedQuest }) {
  // A primitive keeps the selector stable: "done", the board row's state, or null when off the board.
  const boardState = useStore((state) => {
    const isQuest = (row: { questId: string }) => row.questId.toLowerCase() === quest.questId.toLowerCase();
    if (state.sessionCompletedBoards.get(quest.startedFrom.sessionId)?.some(isQuest)) return "done";
    return state.sessionBoards.get(quest.startedFrom.sessionId)?.find(isQuest)?.status ?? null;
  });
  const done = boardState === "done";
  const phase = done ? null : getQuestJourneyPhaseForState(boardState);
  const label = done ? "Done" : (getQuestJourneyPresentation(boardState)?.label ?? phase?.label);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 whitespace-pre text-[12px] text-cc-muted"
      data-testid="supporting-quest-link"
      data-quest-id={quest.questId}
    >
      {phase && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={getQuestPhaseDotStyle(phase)} />}
      {label && <span className={`shrink-0 ${done ? "text-cc-success" : ""}`}>{label} · </span>}
      <QuestInlineLink
        questId={quest.questId}
        surface="chat-feed"
        className="min-w-0 truncate text-cc-fg/80 hover:text-cc-fg hover:underline"
      >
        {quest.title}
      </QuestInlineLink>
    </span>
  );
}

/** Opens a quest thread with a link back to the user's message the quest was filed from. */
export function StartedFromLink({ startedFrom, sessionId }: { startedFrom: QuestStartedFrom; sessionId?: string }) {
  return (
    <ThreadMessageLink
      lead="Started from your message in "
      target={startedFrom}
      sessionId={sessionId}
      className="ml-9 mb-2"
      testId="started-from-link"
    />
  );
}

/**
 * "<lead><thread> · <time> ›": a link to one message of a leader's conversation, naming the
 * thread it is in (Main or the quest's title, plus the leader when it is another one).
 */
export function ThreadMessageLink({
  lead,
  target,
  sessionId,
  className,
  testId,
}: {
  lead: string;
  target: { sessionId: string; messageId: string; threadKey: string; timestamp: number };
  /** The session on screen, to name another leader's conversation. */
  sessionId?: string;
  className: string;
  testId: string;
}) {
  const threadKey = normalizeThreadKey(target.threadKey);
  const main = threadKey === MAIN_THREAD_KEY;
  const questTitle = useStore((state) => (main ? undefined : state.questTitlePreviews.get(threadKey)?.title));
  useEffect(() => {
    if (!main && !questTitle) void useStore.getState().hydrateQuestTitles([threadKey]);
  }, [main, questTitle, threadKey]);
  const otherSessionNum = useStore((state) =>
    sessionId && sessionId !== target.sessionId
      ? state.sdkSessions.find((session) => session.sessionId === target.sessionId)?.sessionNum
      : undefined,
  );
  const place = `${otherSessionNum != null ? `#${otherSessionNum} ` : ""}${main ? "Main" : (questTitle ?? threadKey)}`;
  const time = formatMessageTimestamp(target.timestamp);
  return (
    <button
      type="button"
      onClick={() =>
        navigateToSessionMessageId(target.sessionId, target.messageId, { threadKey, preserveMainThreadRoute: true })
      }
      className={`${className} flex max-w-full items-center gap-0.5 whitespace-pre text-left text-[12px] text-cc-muted hover:text-cc-fg`}
      data-testid={testId}
    >
      <span className="shrink-0">{lead}</span>
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
