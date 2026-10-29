/**
 * Links between the two ends of a conversation fork: a quest filed from one of the user's
 * messages opens its thread with "Started from your message in …", and that message links
 * on to each quest it started ("Continued in …" or "Side quest …"). The user can then follow a
 * conversation that moved to another tab from either end.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { QuestStartedFrom } from "../../server/quest-types.js";
import { leaderResponseOwnerThreadKey } from "../../shared/leader-thread-response-routing.js";
import { fetchStartedQuests, type StartedQuest } from "../api/started-quests.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { formatMessageTimestamp } from "./MessageTimestamp.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

/** Forks this page has already listed, per leader session; a quest listed later is new to the user. */
const listedForks = new Map<string, Set<string>>();
/** New forks whose row has not yet played its first-appearance cue, as `session:quest`. */
const uncuedForks = new Set<string>();

function forkKey(quest: Pick<StartedQuest, "questId" | "startedFrom">): string {
  return `${quest.startedFrom.sessionId}:${quest.startedFrom.messageId}:${quest.questId}`;
}

/**
 * Record a session's started quests. The first list a page loads for a session is what the
 * user already had; links that show up in a later list get the first-appearance cue once. A
 * link is one quest of one message: a reopened quest can continue several requests.
 */
function noteListedForks(sessionId: string, quests: readonly StartedQuest[]): void {
  const listed = listedForks.get(sessionId);
  if (!listed) {
    listedForks.set(sessionId, new Set(quests.map(forkKey)));
    return;
  }
  for (const quest of quests) {
    const key = forkKey(quest);
    if (listed.has(key)) continue;
    listed.add(key);
    uncuedForks.add(key);
  }
}

/** Give a fork row its first-appearance cue, as if its quest were just filed (Playground and tests). */
export function markQuestForkNew(quest: Pick<StartedQuest, "questId" | "startedFrom">): void {
  uncuedForks.add(forkKey(quest));
}

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
      .then((list) => {
        noteListedForks(sessionId, list);
        setQuests(list);
      })
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

/**
 * Under a user's message: the quests it started, except the one whose thread is on screen.
 * A request moved into its quest (Main-to-quest handoff) continues there, and so does a
 * quest the user has written in; any other quest is a side quest, supporting a request
 * that stays and is answered where it was asked. The message's own route is checked too,
 * because it updates as soon as a handoff lands, while the started quests were often
 * loaded just before it, when the quest was filed.
 */
export function ContinuedInLinks({
  message,
  currentThreadKey,
  onSelectThread,
  exclude,
}: {
  message: Pick<ChatMessage, "id" | "metadata">;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  /** A quest named elsewhere on the message (its quest breadcrumb). */
  exclude?: string;
}) {
  const quests = useContext(StartedQuestsContext)?.get(message.id);
  const current = currentThreadKey ? normalizeThreadKey(currentThreadKey) : null;
  const shown =
    quests?.filter((quest) => normalizeThreadKey(quest.questId) !== current && quest.questId !== exclude) ?? [];
  if (!onSelectThread || shown.length === 0) return null;
  const owner = leaderResponseOwnerThreadKey(message.metadata ?? {});
  return (
    <div className="mt-1.5 flex flex-col items-end gap-0.5" data-testid="continued-in-links">
      {shown.map((quest) => (
        <QuestForkLink
          key={quest.questId}
          quest={quest}
          continued={normalizeThreadKey(quest.questId) === owner || !quest.sideQuest}
          onSelectThread={onSelectThread}
        />
      ))}
    </div>
  );
}

/**
 * "Continued in q-N Title ›" or "Side quest q-N Title ›": the number previews the quest
 * like any quest link, and the title opens the quest's thread either way, since a side
 * quest's thread can grow into a conversation of its own: a continued request at the message
 * itself, where its conversation goes on.
 */
function QuestForkLink({
  quest,
  continued,
  onSelectThread,
}: {
  quest: StartedQuest;
  continued: boolean;
  onSelectThread: (threadKey: string) => void;
}) {
  // The cue ends when its animation does, not when the row mounts: a row mounted in a hidden
  // kept conversation plays it once that conversation is shown, and a remount doesn't replay it.
  const [cued, setCued] = useState(() => uncuedForks.has(forkKey(quest)));
  return (
    <span
      className="quest-fork-link -mx-1.5 inline-flex max-w-full items-center gap-1 whitespace-pre rounded-full px-1.5 text-[12px] text-cc-muted"
      data-cue={cued ? "sheen" : undefined}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        uncuedForks.delete(forkKey(quest));
        setCued(false);
      }}
      title={continued ? "The conversation continues in this quest's thread" : "Side quest: the answer comes back here"}
      data-testid="quest-fork-link"
      data-quest-id={quest.questId}
      data-mode={continued ? "continued" : "side-quest"}
    >
      <span className="shrink-0">{continued ? "Continued in" : "Side quest"}</span>
      <QuestInlineLink questId={quest.questId} surface="chat-feed" className="cc-quest-link hover:underline">
        {quest.questId}
      </QuestInlineLink>
      <button
        type="button"
        onClick={() =>
          // A request that moved into its quest continues right there, at that message; a side
          // quest's thread opens as usual.
          continued
            ? navigateToSessionMessageId(quest.startedFrom.sessionId, quest.startedFrom.messageId, {
                threadKey: normalizeThreadKey(quest.questId),
              })
            : onSelectThread(normalizeThreadKey(quest.questId))
        }
        className="group inline-flex min-w-0 items-center gap-0.5 hover:text-cc-fg"
        data-testid="quest-fork-thread-link"
      >
        <span className="min-w-0 truncate text-cc-primary group-hover:underline">{quest.title}</span>
        <ArrowGlyph />
      </button>
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
