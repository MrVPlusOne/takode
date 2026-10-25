import { Fragment, memo, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import type { ChatMessage } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { getEntryId, isUserBoundaryEntry, type FeedEntry, type Turn } from "../hooks/use-feed-model.js";
import { FeedEntries, isCompactableHerdEventEntry } from "./MessageFeedEntries.js";
import { CodexSubagentTurnSegment } from "./CodexSubagentTurnSegment.js";
import { TurnActivityDisclosure } from "./TurnActivitySummary.js";
import { extractQuestQuizMarkerIds } from "./AssistantQuestQuizContent.js";
import {
  appendTimedMessagesFromEntries,
  buildMinuteBoundaryLabelMap,
  getQuestCompletionFeedBlockId,
  getTurnFeedBlockId,
  isTimedChatMessage,
} from "./message-feed-utils.js";
import type { FeedSection } from "./message-feed-sections.js";
import { PawTrailAvatar, HidePawContext } from "./PawTrail.js";
import { getAssistantVisibleMarkdown } from "../utils/assistant-message-renderability.js";
import { CompactFeedActivity } from "./CompactFeedActivity.js";
import {
  collapsedResponseEntry,
  readyThreadResponseAppliesToTurn,
  threadResponsePresentationTouchesTurn,
  type ThreadResponsePresentation,
} from "./thread-response-presentation.js";
import {
  CollapsedTurnRows,
  readyThreadResponseRows,
  readyThreadResponseTurnHasContent,
  readyThreadResponseTurnHasMessage,
  firstEntryAfter,
  type CollapsedTurnRow,
  type TimedCard,
} from "./ReadyThreadResponseRows.js";
import { getTurnSummaryDurationMs } from "./message-feed-turn-duration.js";
import { InlineMessageTimingVisibilityContext } from "./MessageTimestamp.js";
import { TurnThreadStatusFooter } from "./MessageFeedThreadStatus.js";
import type { WaitingWorkerTarget } from "./WaitingWorkerPreview.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { QuestCompletionSummaryCard } from "./QuestCompletionSummaryCard.js";
import { AnswerReferencesContext, answerChromeFor, type AnswerReferenceData } from "./answer-references.js";
import { QuestDescriptionSummaryCard } from "./QuestDescriptionSummaryCard.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";
import { TopicFeedContext, TopicFeedQuestStart, topicQuestsOfTurns } from "./topic-feed.js";
import { TopicFeedEntry } from "./library/TopicConversation.js";

function entryHasModelActivity(entry: FeedEntry): boolean {
  if (entry.kind !== "message") return true;
  return entry.msg.role === "assistant";
}

function turnPresentationEntries(turn: Turn): FeedEntry[] {
  return turn.presentationEntries ?? turn.allEntries;
}

function turnHasModelActivity(turn: Turn): boolean {
  return turnPresentationEntries(turn).some(entryHasModelActivity);
}

function latestStatusHostTurnId(sections: FeedSection[]): string | null {
  let latestTurnId: string | null = null;
  for (let sectionIndex = sections.length - 1; sectionIndex >= 0; sectionIndex--) {
    const turns = sections[sectionIndex].turns;
    for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
      const turn = turns[turnIndex];
      latestTurnId ??= turn.id;
      if (turnHasModelActivity(turn)) return turn.id;
    }
  }
  return latestTurnId;
}

/**
 * The newest assistant message a collapsed turn card shows, so an answer that
 * arrives live in a collapsed turn moves the feed's paw onto that card.
 */
function collapsedPawMessageId(turn: Turn, unansweredMessageEntry: FeedEntry | null): string | undefined {
  if (unansweredMessageEntry?.kind === "message") return unansweredMessageEntry.msg.id;
  const rows = turn.collapsedEntries ?? [];
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.kind === "entry" && row.entry.kind === "message" && row.entry.msg.role === "assistant") {
      return row.entry.msg.id;
    }
  }
  return turn.responseEntry?.kind === "message" ? turn.responseEntry.msg.id : undefined;
}

function turnQuestQuizIds(turn: Turn): string[] {
  return turnPresentationEntries(turn).flatMap((entry) =>
    entry.kind === "message" && entry.msg.role === "assistant"
      ? extractQuestQuizMarkerIds(getAssistantVisibleMarkdown(entry.msg))
      : [],
  );
}

/** When a turn began: its boundary message, or its first message when it has none. */
function turnStartTimestamp(turn: Turn): number | null {
  const first = [turn.userEntry, ...turn.allEntries].find((entry) => entry?.kind === "message");
  return first?.kind === "message" ? first.msg.timestamp : null;
}

/**
 * The turn a completed quest's summary card belongs in: the one that was running or
 * latest when the quest completed. Inside it the card sits at the completion time,
 * so later answers in the same turn render below it. Leader turns start only at
 * human messages, so that turn also holds the herd events reporting the completion.
 * A host that may sit in an unloaded section gives no card.
 */
function questCompletionSummaryHost(
  turns: readonly Turn[],
  completedAt: number | null,
  hasOlderSections: boolean,
  hasNewerSections: boolean,
): string | null {
  if (completedAt === null || turns.length === 0) return null;
  const nextIndex = turns.findIndex((turn) => (turnStartTimestamp(turn) ?? -Infinity) > completedAt);
  if (nextIndex === -1) return hasNewerSections ? null : turns[turns.length - 1].id;
  if (nextIndex === 0) return hasOlderSections ? null : turns[0].id;
  return turns[nextIndex - 1].id;
}

function CollapsedTurnContent({
  turn,
  sessionId,
  currentThreadKey,
  minuteBoundaryLabels,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
  onSelectThread,
  questLinkSurface,
  threadResponsePresentation,
  needsInputAnchorMessageIds,
  preserveHostQuestQuiz,
  unansweredMessageEntry,
  completionCard,
}: {
  turn: Turn;
  sessionId: string;
  currentThreadKey: string;
  minuteBoundaryLabels: Map<string, string>;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
  onSelectThread?: (threadKey: string) => void;
  questLinkSurface: QuestLinkSurface;
  threadResponsePresentation?: ThreadResponsePresentation | null;
  needsInputAnchorMessageIds: ReadonlySet<string>;
  preserveHostQuestQuiz: boolean;
  unansweredMessageEntry: Extract<FeedEntry, { kind: "message" }> | null;
  completionCard: TimedCard | null;
}) {
  const answerReferences = useContext(AnswerReferencesContext);
  const renderEntry = (entry: FeedEntry) =>
    isCompactableHerdEventEntry(entry) ? (
      <CompactFeedActivity
        segments={[{ kind: "worker_event", messages: [entry.msg] }]}
        sessionId={sessionId}
        isCodexSession={isCodexSession}
        activeCodexTerminalIds={activeCodexTerminalIds}
        onOpenCodexTerminal={onOpenCodexTerminal}
        questLinkSurface={questLinkSurface}
      />
    ) : (
      <FeedEntries
        entries={[entry]}
        sessionId={sessionId}
        currentThreadKey={currentThreadKey}
        minuteBoundaryLabels={minuteBoundaryLabels}
        isCodexSession={isCodexSession}
        activeCodexTerminalIds={activeCodexTerminalIds}
        onOpenCodexTerminal={onOpenCodexTerminal}
        onSelectThread={onSelectThread}
        suppressThreadSystemMarkers
        questLinkSurface={questLinkSurface}
      />
    );
  // Both presentations render through the same row list, so a message keeps its
  // row (and its loaded images) when the answer presentation comes and goes.
  const { rows, quizQuestIds } = threadResponsePresentation
    ? readyThreadResponseRows(turn, threadResponsePresentation, needsInputAnchorMessageIds, unansweredMessageEntry)
    : fallbackCollapsedRows(turn, preserveHostQuestQuiz, unansweredMessageEntry, answerReferences);
  return (
    <CollapsedTurnRows
      rows={rows}
      quizQuestIds={quizQuestIds}
      renderEntry={renderEntry}
      sessionId={sessionId}
      currentThreadKey={currentThreadKey}
      onSelectThread={onSelectThread}
      questLinkSurface={questLinkSurface}
      timedCard={completionCard}
    />
  );
}

/** A collapsed turn's rows when no answer presentation applies: its visible entries. */
function fallbackCollapsedRows(
  turn: Turn,
  preserveHostQuestQuiz: boolean,
  unansweredMessageEntry: Extract<FeedEntry, { kind: "message" }> | null,
  answerReferences: ReadonlyMap<string, AnswerReferenceData> | null,
): { rows: CollapsedTurnRow[]; quizQuestIds: string[] } {
  const rows: CollapsedTurnRow[] = [
    // Sub-conclusions lead the card, set slightly apart from the rows below.
    ...turn.subConclusions.map((item, index) => ({
      key: `entry:${getEntryId(item.entry)}`,
      entry: item.entry,
      className: `min-w-0 px-3 ${index === 0 ? "pt-2" : "pt-1.5"}`,
    })),
    ...(turn.collapsedEntries ?? []).flatMap((row) =>
      row.kind === "entry" ? [{ key: `entry:${getEntryId(row.entry)}`, entry: row.entry }] : [],
    ),
  ];
  // All Threads has no thread projection; its answers carry the same chrome from their own metadata.
  const turnMessageId = turn.userEntry?.kind === "message" ? turn.userEntry.msg.id : undefined;
  rows.forEach((row, index) => {
    if (row.entry.kind !== "message") return;
    const answer = answerChromeFor(row.entry.msg, answerReferences, index === 0 ? turnMessageId : undefined);
    if (answer) row.answer = answer;
  });
  if (unansweredMessageEntry) {
    rows.push({
      key: `entry:${unansweredMessageEntry.msg.id}`,
      entry: unansweredMessageEntry,
      testId: "collapsed-turn-unanswered-message",
    });
  }
  if (!preserveHostQuestQuiz) return { rows, quizQuestIds: [] };
  // This path has no response presentation to carry a separate Quiz row. Rebuild
  // only directives already owned by this turn, and skip any a visible row renders itself.
  const visibleQuizIds = new Set(
    rows.flatMap((row) =>
      row.entry.kind === "message" ? extractQuestQuizMarkerIds(getAssistantVisibleMarkdown(row.entry.msg)) : [],
    ),
  );
  return {
    rows,
    quizQuestIds: [...new Set(turnQuestQuizIds(turn))].filter((questId) => !visibleQuizIds.has(questId)),
  };
}

interface TurnEntryRun {
  key: string;
  activity: boolean;
  entries: FeedEntry[];
  /** The turn's timed card goes right before this run. */
  startsAfterCard?: boolean;
}

function groupTurnActivity(
  turn: Turn,
  presentation?: ThreadResponsePresentation | null,
  cardAt?: number,
): TurnEntryRun[] {
  // System events' separate collapse policy must not split the surrounding
  // activity guide. Retained answers and decisions remain layout boundaries.
  const guidedEntryIds = new Set([...turn.agentEntries, ...turn.systemEntries].map(getEntryId));
  const retainedIds = new Set(turn.subConclusions.map((item) => getEntryId(item.entry)));
  for (const response of presentation?.currentResponses ?? []) retainedIds.add(response.response.currentMessageId);
  const runs: TurnEntryRun[] = [];
  const entries = turnPresentationEntries(turn);
  const cardIndex = cardAt === undefined ? -1 : firstEntryAfter(entries, cardAt);

  // Group only adjacent activity; an answer or decision breaks the guide without
  // moving any entry across it. Existing feed classification owns visibility.
  entries.forEach((entry, index) => {
    const key = getEntryId(entry);
    const activity = guidedEntryIds.has(key) && !retainedIds.has(key);
    const previous = runs.at(-1);
    if (index === cardIndex) runs.push({ key, activity, entries: [entry], startsAfterCard: true });
    else if (previous?.activity === activity) previous.entries.push(entry);
    else runs.push({ key, activity, entries: [entry] });
  });
  return runs;
}

export const TurnEntriesExpanded = memo(function TurnEntriesExpanded({
  turn,
  threadStatusFooter,
  timedCard = null,
  isLatestTurn = false,
  ...feedProps
}: {
  turn: Turn;
  threadStatusFooter?: ReactNode;
  /** Placed before the first entry written after its time, else after the entries. */
  timedCard?: TimedCard | null;
  /** The feed's last turn, whose trailing activity group is still active. */
  isLatestTurn?: boolean;
} & Omit<ComponentProps<typeof FeedEntries>, "entries" | "endsFeed" | "followsMessageId">) {
  const cardAt = timedCard?.at;
  const runs = useMemo(
    () => groupTurnActivity(turn, feedProps.threadResponsePresentation, cardAt),
    [turn, feedProps.threadResponsePresentation, cardAt],
  );
  const card = timedCard && (
    <div
      key="timed-card"
      className="min-w-0 pl-9 empty:hidden"
      data-testid="expanded-turn-timed-card"
      data-feed-block-id={timedCard.blockId}
    >
      {timedCard.node}
    </div>
  );
  const turnMessageId = turn.userEntry?.kind === "message" ? turn.userEntry.msg.id : undefined;
  // One flat keyed list, so the card and every run keep their elements when the card's place changes.
  const items: ReactNode[] = [];
  runs.forEach((run, runIndex) => {
    const content = (
      <FeedEntries
        {...feedProps}
        entries={run.entries}
        endsFeed={isLatestTurn && runIndex === runs.length - 1}
        followsMessageId={runIndex === 0 ? turnMessageId : undefined}
      />
    );
    const runElement = (
      <div
        key={run.key}
        className={
          run.activity ? "space-y-2 border-l border-cc-border/70 pl-7 sm:space-y-3 sm:pl-9" : "space-y-2 sm:space-y-3"
        }
        data-turn-activity={run.activity ? "true" : undefined}
      >
        {run.activity ? <HidePawContext.Provider value={true}>{content}</HidePawContext.Provider> : content}
      </div>
    );
    if (run.startsAfterCard) items.push(card);
    items.push(runElement);
  });
  if (!runs.some((run) => run.startsAfterCard)) items.push(card);
  return (
    <>
      {items}
      {threadStatusFooter}
    </>
  );
});

export const TurnEntries = memo(function TurnEntries({
  sections,
  sessionId,
  currentThreadKey,
  leaderSession = false,
  showInlineMessageTiming,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
  onSelectThread,
  turnStates,
  toggleTurn,
  userBoundarySourceSessionId,
  questLinkSurface,
  threadResponsePresentation,
  topicResponsePresentations = null,
  needsInputAnchorMessageIds,
  visibleThreadStatuses,
  workerPreviewTarget = null,
  onThreadStatusLayoutContributionChange,
  hasOlderSections = false,
  hasNewerSections = false,
}: {
  sections: FeedSection[];
  sessionId: string;
  currentThreadKey: string;
  /** Collapsed turns without an answer show their last message (leader feeds only). */
  leaderSession?: boolean;
  showInlineMessageTiming: boolean;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
  onSelectThread?: (threadKey: string) => void;
  turnStates: Array<{ defaultExpanded: boolean; isActivityExpanded: boolean } | undefined>;
  toggleTurn: (turnId: string) => void;
  userBoundarySourceSessionId?: string | null;
  questLinkSurface: QuestLinkSurface;
  threadResponsePresentation?: ThreadResponsePresentation | null;
  /** In a topic conversation: each quest's answer presentation, used for that quest's turns. */
  topicResponsePresentations?: ReadonlyMap<string, ThreadResponsePresentation | null> | null;
  needsInputAnchorMessageIds: ReadonlySet<string>;
  visibleThreadStatuses: LeaderThreadStatus[];
  /** Worker the thread waits on; its live preview renders under the status footer. */
  workerPreviewTarget?: WaitingWorkerTarget | null;
  onThreadStatusLayoutContributionChange?: (height: number) => void;
  /** The loaded window starts after the thread's first section. */
  hasOlderSections?: boolean;
  /** The loaded window ends before the thread's newest section. */
  hasNewerSections?: boolean;
}) {
  const turns = useMemo(() => sections.flatMap((section) => section.turns), [sections]);
  const sectionStartTurnIds = useMemo(
    () => new Set(sections.flatMap((section) => section.turns.slice(0, 1).map((turn) => turn.id))),
    [sections],
  );
  const threadQuestId =
    leaderSession && isQuestThreadKey(currentThreadKey.toLowerCase()) ? currentThreadKey.toLowerCase() : null;
  const topicFeed = useContext(TopicFeedContext);
  const turnQuests = useMemo(
    () => (topicFeed ? topicQuestsOfTurns(turns, topicFeed.questIds) : null),
    [topicFeed, turns],
  );
  const threadQuest = useQuestRecord(threadQuestId);
  const completedAt = threadQuest?.status === "done" ? threadQuest.completedAt : null;
  const completionSummaryHostTurnId = useMemo(
    () => (threadQuestId ? questCompletionSummaryHost(turns, completedAt, hasOlderSections, hasNewerSections) : null),
    [threadQuestId, completedAt, hasOlderSections, hasNewerSections, turns],
  );
  const latestThreadResponseUpdatedAt = Math.max(
    0,
    ...(threadResponsePresentation?.currentResponses
      .filter((item) => item.response.coveredUserMessageIds.length > 0)
      .map((item) => item.response.updatedAt) ?? []),
  );
  const readyThreadResponsePresentation =
    threadResponsePresentation?.ready &&
    visibleThreadStatuses.some((status) => status.kind === "ready" && status.timestamp >= latestThreadResponseUpdatedAt)
      ? threadResponsePresentation
      : null;
  const hasThreadStatusFooter = visibleThreadStatuses.length > 0 || workerPreviewTarget !== null;
  const threadStatusFooterTurnId = useMemo(
    () => (hasThreadStatusFooter ? latestStatusHostTurnId(sections) : null),
    [sections, hasThreadStatusFooter],
  );
  const minuteBoundaryLabels = useMemo(() => {
    const visibleTimedMessages: ChatMessage[] = [];

    for (let index = 0; index < turns.length; index++) {
      const turn = turns[index];
      const isActivityExpanded = turnStates[index]?.isActivityExpanded ?? false;

      if (turn.userEntry?.kind === "message" && isTimedChatMessage(turn.userEntry.msg)) {
        visibleTimedMessages.push(turn.userEntry.msg);
      }

      if (isActivityExpanded) {
        appendTimedMessagesFromEntries(turnPresentationEntries(turn), visibleTimedMessages);
      } else if (
        !readyThreadResponsePresentation ||
        !readyThreadResponseAppliesToTurn(turn, readyThreadResponsePresentation)
      ) {
        appendTimedMessagesFromEntries(turn.systemEntries, visibleTimedMessages);
      }
    }

    return buildMinuteBoundaryLabelMap(visibleTimedMessages);
  }, [readyThreadResponsePresentation, turns, turnStates]);
  return (
    <InlineMessageTimingVisibilityContext.Provider value={showInlineMessageTiming}>
      {/* Opens the thread with what the quest is about, once its first section is loaded. */}
      {threadQuestId && !hasOlderSections && <TopicFeedEntry />}
      {threadQuestId && !hasOlderSections && (
        <QuestDescriptionSummaryCard
          questId={threadQuestId}
          sessionId={sessionId}
          questLinkSurface={questLinkSurface}
        />
      )}
      {/* One flat list keyed by turn: section boundaries move whenever the latest
          window slides, and a turn re-parented into another section wrapper would
          remount, reloading every visible message and image. */}
      {turns.map((turn, turnIndex) => {
        const turnState = turnStates[turnIndex];
        const isActivityExpanded = turnState?.isActivityExpanded ?? false;
        const preserveHostQuestQuiz = turnIndex === turns.length - 1 && turnState?.defaultExpanded === false;
        const turnQuest = turnQuests?.[turnIndex] ?? null;
        const answers = topicResponsePresentations
          ? turnQuest
            ? (topicResponsePresentations.get(turnQuest) ?? null)
            : null
          : threadResponsePresentation;
        const turnResponsePresentation = answers && readyThreadResponseAppliesToTurn(turn, answers) ? answers : null;
        const collapsedThreadResponsePresentation =
          turnResponsePresentation &&
          (readyThreadResponsePresentation || threadResponsePresentationTouchesTurn(turn, turnResponsePresentation))
            ? turnResponsePresentation
            : null;
        const collapsedShowsMessage = collapsedThreadResponsePresentation
          ? readyThreadResponseTurnHasMessage(turn, collapsedThreadResponsePresentation, needsInputAnchorMessageIds)
          : turn.subConclusions.length > 0 ||
            (turn.collapsedEntries?.some(
              (row) => row.kind === "entry" && row.entry.kind === "message" && row.entry.msg.role === "assistant",
            ) ??
              false);
        // Display only: a handed-off or dispatch-only turn keeps its last note
        // visible, while answer coverage and Ready state stay unchanged.
        const unansweredMessageEntry =
          leaderSession && !isActivityExpanded && !collapsedShowsMessage && turn.lastMessageEntry
            ? collapsedResponseEntry(turn.lastMessageEntry)
            : null;
        const hasCollapsedContent =
          unansweredMessageEntry !== null ||
          (collapsedThreadResponsePresentation
            ? readyThreadResponseTurnHasContent(turn, collapsedThreadResponsePresentation, needsInputAnchorMessageIds)
            : (turn.collapsedEntries?.some((row) => row.kind === "entry") ?? false) || turn.subConclusions.length > 0);
        const hasCollapsedCurrentAnswer =
          collapsedThreadResponsePresentation?.currentResponses.some((item) => item.sourceTurnId === turn.id) ?? false;
        const turnSummaryDuration = getTurnSummaryDurationMs(turn);
        const showThreadStatusFooter = turn.id === threadStatusFooterTurnId;
        const completionCard: TimedCard | null =
          threadQuestId && completedAt !== null && completionSummaryHostTurnId === turn.id
            ? {
                at: completedAt,
                blockId: getQuestCompletionFeedBlockId(threadQuestId),
                node: (
                  <QuestCompletionSummaryCard
                    questId={threadQuestId}
                    sessionId={sessionId}
                    questLinkSurface={questLinkSurface}
                  />
                ),
              }
            : null;
        // Without entries or collapsed rows to sit among, the card ends the turn.
        const hasEntryRows = isActivityExpanded ? turnPresentationEntries(turn).length > 0 : hasCollapsedContent;
        const completionSummaryCard =
          completionCard && !hasEntryRows ? (
            <div className="min-w-0 pl-9" data-feed-block-id={completionCard.blockId}>
              {completionCard.node}
            </div>
          ) : null;
        const threadStatusFooter =
          showThreadStatusFooter || completionSummaryCard ? (
            <>
              {completionSummaryCard}
              {showThreadStatusFooter && (
                <TurnThreadStatusFooter
                  statuses={visibleThreadStatuses}
                  workerPreviewTarget={workerPreviewTarget}
                  currentThreadKey={currentThreadKey}
                  onSelectThread={onSelectThread}
                  onLayoutContributionChange={onThreadStatusLayoutContributionChange}
                />
              )}
            </>
          ) : null;

        const questStarts = topicFeed && turnQuest && turnQuest !== (turnQuests?.[turnIndex - 1] ?? null);
        return (
          <Fragment key={turn.id}>
            {questStarts && <TopicFeedQuestStart questId={turnQuest} />}
            <div data-feed-section-id={sectionStartTurnIds.has(turn.id) ? turn.id : undefined}>
              <div
                data-turn-id={turn.id}
                data-feed-block-id={getTurnFeedBlockId(turn.id)}
                className="turn-container space-y-2 sm:space-y-3"
                data-user-turn={isUserBoundaryEntry(turn.userEntry, userBoundarySourceSessionId) ? "true" : undefined}
              >
                {turn.userEntry && (
                  <FeedEntries
                    entries={[turn.userEntry]}
                    sessionId={sessionId}
                    currentThreadKey={currentThreadKey}
                    minuteBoundaryLabels={minuteBoundaryLabels}
                    isCodexSession={isCodexSession}
                    activeCodexTerminalIds={activeCodexTerminalIds}
                    onOpenCodexTerminal={onOpenCodexTerminal}
                    onSelectThread={onSelectThread}
                    questLinkSurface={questLinkSurface}
                  />
                )}

                {turnPresentationEntries(turn).length > 0 && (
                  <div className="min-w-0">
                    <TurnActivityDisclosure
                      stats={turn.stats}
                      durationMs={turnSummaryDuration}
                      expanded={isActivityExpanded}
                      onToggle={() => toggleTurn(turn.id)}
                    />
                  </div>
                )}
                {!isActivityExpanded && !collapsedThreadResponsePresentation && (
                  <CodexSubagentTurnSegment sessionId={sessionId} turnId={turn.id} />
                )}
                {isActivityExpanded ? (
                  turnPresentationEntries(turn).length > 0 && (
                    <TurnEntriesExpanded
                      turn={turn}
                      isLatestTurn={turnIndex === turns.length - 1}
                      sessionId={sessionId}
                      currentThreadKey={currentThreadKey}
                      threadStatusFooter={threadStatusFooter}
                      timedCard={completionCard}
                      minuteBoundaryLabels={minuteBoundaryLabels}
                      isCodexSession={isCodexSession}
                      activeCodexTerminalIds={activeCodexTerminalIds}
                      onOpenCodexTerminal={onOpenCodexTerminal}
                      onSelectThread={onSelectThread}
                      questLinkSurface={questLinkSurface}
                      threadResponsePresentation={turnResponsePresentation}
                    />
                  )
                ) : (
                  <>
                    {!collapsedThreadResponsePresentation && turn.systemEntries.length > 0 && (
                      <FeedEntries
                        entries={turn.systemEntries}
                        sessionId={sessionId}
                        currentThreadKey={currentThreadKey}
                        minuteBoundaryLabels={minuteBoundaryLabels}
                        isCodexSession={isCodexSession}
                        activeCodexTerminalIds={activeCodexTerminalIds}
                        onOpenCodexTerminal={onOpenCodexTerminal}
                        onSelectThread={onSelectThread}
                        suppressThreadSystemMarkers
                        questLinkSurface={questLinkSurface}
                      />
                    )}
                    {hasCollapsedContent && (
                      <div
                        className={
                          hasCollapsedCurrentAnswer
                            ? "flex min-w-0 items-start"
                            : "flex min-w-0 items-start gap-2 sm:gap-3"
                        }
                        data-testid={hasCollapsedCurrentAnswer ? "thread-response-collapsed-shell" : undefined}
                      >
                        {!hasCollapsedCurrentAnswer && (
                          <PawTrailAvatar messageId={collapsedPawMessageId(turn, unansweredMessageEntry)} />
                        )}
                        {/* Clip, not hide: a hidden overflow is a scroll container, which would keep an
                            expanded report's collapse bar from sticking to the feed's top. */}
                        <div className="flex-1 min-w-0 rounded-xl border border-cc-border/20 bg-cc-card/20 overflow-clip">
                          <CollapsedTurnContent
                            turn={turn}
                            sessionId={sessionId}
                            currentThreadKey={currentThreadKey}
                            minuteBoundaryLabels={minuteBoundaryLabels}
                            isCodexSession={isCodexSession}
                            activeCodexTerminalIds={activeCodexTerminalIds}
                            onOpenCodexTerminal={onOpenCodexTerminal}
                            onSelectThread={onSelectThread}
                            questLinkSurface={questLinkSurface}
                            threadResponsePresentation={collapsedThreadResponsePresentation}
                            needsInputAnchorMessageIds={needsInputAnchorMessageIds}
                            preserveHostQuestQuiz={preserveHostQuestQuiz}
                            unansweredMessageEntry={unansweredMessageEntry}
                            completionCard={completionCard}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
                {(!isActivityExpanded || turnPresentationEntries(turn).length === 0) && threadStatusFooter}
              </div>
            </div>
          </Fragment>
        );
      })}
    </InlineMessageTimingVisibilityContext.Provider>
  );
});
