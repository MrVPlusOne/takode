import { memo, useMemo, type ComponentProps, type ReactNode } from "react";
import type { ChatMessage } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { getEntryId, isUserBoundaryEntry, type FeedEntry, type Turn } from "../hooks/use-feed-model.js";
import { FeedEntries, isCompactableHerdEventEntry } from "./MessageFeedEntries.js";
import { CodexSubagentTurnSegment } from "./CodexSubagentTurnSegment.js";
import { TurnActivityDisclosure } from "./TurnActivitySummary.js";
import { AssistantQuestQuizContent, extractQuestQuizMarkerIds } from "./AssistantQuestQuizContent.js";
import {
  appendTimedMessagesFromEntries,
  buildMinuteBoundaryLabelMap,
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
  ReadyThreadResponseRows,
  readyThreadResponseTurnHasContent,
  readyThreadResponseTurnHasMessage,
} from "./ReadyThreadResponseRows.js";
import { getTurnSummaryDurationMs } from "./message-feed-turn-duration.js";
import { InlineMessageTimingVisibilityContext } from "./MessageTimestamp.js";
import { TurnThreadStatusFooter } from "./MessageFeedThreadStatus.js";
import type { WaitingWorkerTarget } from "./WaitingWorkerPreview.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { QuestCompletionSummaryCard, QuestCompletionSummaryContext } from "./QuestCompletionSummaryCard.js";
import { QuestDescriptionSummaryCard } from "./QuestDescriptionSummaryCard.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";

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
 * Where a completed quest's summary card belongs in its leader quest thread: above the
 * latest Quiz for that quest, otherwise at the end of the turn that was running or
 * latest when the quest completed, so later messages never push it down. Leader turns
 * start only at human messages, so that turn also holds the herd events reporting the
 * completion. A host that may sit in an unloaded section gives no card.
 */
function questCompletionSummaryHost(
  turns: readonly Turn[],
  questId: string,
  completedAt: number | null,
  hasOlderSections: boolean,
  hasNewerSections: boolean,
): { turnId: string; withQuiz: boolean } | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    if (turnQuestQuizIds(turns[index]).includes(questId)) return { turnId: turns[index].id, withQuiz: true };
  }
  if (completedAt === null || turns.length === 0) return null;
  const nextIndex = turns.findIndex((turn) => (turnStartTimestamp(turn) ?? -Infinity) > completedAt);
  if (nextIndex === -1) return hasNewerSections ? null : { turnId: turns[turns.length - 1].id, withQuiz: false };
  if (nextIndex === 0) return hasOlderSections ? null : { turnId: turns[0].id, withQuiz: false };
  return { turnId: turns[nextIndex - 1].id, withQuiz: false };
}

function CollapsedTurnRows({
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
  activeNeedsInputAnchorMessageIds,
  preserveHostQuestQuiz,
  unansweredMessageEntry,
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
  activeNeedsInputAnchorMessageIds: ReadonlySet<string>;
  preserveHostQuestQuiz: boolean;
  unansweredMessageEntry: Extract<FeedEntry, { kind: "message" }> | null;
}) {
  const collapsedEntries = turn.collapsedEntries ?? [];
  const renderEntry = (entry: FeedEntry) => (
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
  if (threadResponsePresentation) {
    return (
      <ReadyThreadResponseRows
        turn={turn}
        presentation={threadResponsePresentation}
        sessionId={sessionId}
        currentThreadKey={currentThreadKey}
        onSelectThread={onSelectThread}
        questLinkSurface={questLinkSurface}
        activeNeedsInputAnchorMessageIds={activeNeedsInputAnchorMessageIds}
        unansweredMessageEntry={unansweredMessageEntry}
        renderEntry={renderEntry}
      />
    );
  }
  // The fallback Ready path has no response presentation to carry a separate Quiz row.
  // Rebuild only directives already owned by this turn, and skip any representative that renders one itself.
  const hiddenHostQuizIds = preserveHostQuestQuiz
    ? (() => {
        const visibleQuizIds = new Set(
          collapsedEntries.flatMap((row) =>
            row.kind === "entry" && row.entry.kind === "message"
              ? extractQuestQuizMarkerIds(getAssistantVisibleMarkdown(row.entry.msg))
              : [],
          ),
        );
        return [...new Set(turnQuestQuizIds(turn))].filter((questId) => !visibleQuizIds.has(questId));
      })()
    : [];
  return (
    <>
      {collapsedEntries.map((row) => {
        if (row.kind === "activity") return null;

        return (
          <div key={row.key} className="px-2.5 py-2 sm:px-3">
            <HidePawContext.Provider value={true}>
              {isCompactableHerdEventEntry(row.entry) ? (
                <CompactFeedActivity
                  segments={[{ kind: "worker_event", messages: [row.entry.msg] }]}
                  sessionId={sessionId}
                  isCodexSession={isCodexSession}
                  activeCodexTerminalIds={activeCodexTerminalIds}
                  onOpenCodexTerminal={onOpenCodexTerminal}
                  questLinkSurface={questLinkSurface}
                />
              ) : (
                renderEntry(row.entry)
              )}
            </HidePawContext.Provider>
          </div>
        );
      })}
      {unansweredMessageEntry && (
        <div className="px-2.5 py-2 sm:px-3" data-testid="collapsed-turn-unanswered-message">
          <HidePawContext.Provider value={true}>{renderEntry(unansweredMessageEntry)}</HidePawContext.Provider>
        </div>
      )}
      {hiddenHostQuizIds.length > 0 && (
        <div className="min-w-0 px-2.5 pb-2 sm:px-3" data-testid="thread-response-quiz">
          <AssistantQuestQuizContent
            text={hiddenHostQuizIds.map((questId) => `{[(Quest Quiz: ${questId})]}`).join("\n")}
            sessionId={sessionId}
            questLinkSurface={questLinkSurface}
          />
        </div>
      )}
    </>
  );
}

interface TurnEntryRun {
  key: string;
  activity: boolean;
  entries: FeedEntry[];
}

function groupTurnActivity(turn: Turn, presentation?: ThreadResponsePresentation | null): TurnEntryRun[] {
  // System events' separate collapse policy must not split the surrounding
  // activity guide. Retained answers and decisions remain layout boundaries.
  const guidedEntryIds = new Set([...turn.agentEntries, ...turn.systemEntries].map(getEntryId));
  const retainedIds = new Set(turn.subConclusions.map((item) => getEntryId(item.entry)));
  for (const response of presentation?.currentResponses ?? []) retainedIds.add(response.response.currentMessageId);
  const runs: TurnEntryRun[] = [];

  // Group only adjacent activity; an answer or decision breaks the guide without
  // moving any entry across it. Existing feed classification owns visibility.
  for (const entry of turnPresentationEntries(turn)) {
    const key = getEntryId(entry);
    const activity = guidedEntryIds.has(key) && !retainedIds.has(key);
    const previous = runs.at(-1);
    if (previous?.activity === activity) previous.entries.push(entry);
    else runs.push({ key, activity, entries: [entry] });
  }
  return runs;
}

export const TurnEntriesExpanded = memo(function TurnEntriesExpanded({
  turn,
  threadStatusFooter,
  isLatestTurn = false,
  ...feedProps
}: {
  turn: Turn;
  threadStatusFooter?: ReactNode;
  /** The feed's last turn, whose trailing activity group is still active. */
  isLatestTurn?: boolean;
} & Omit<ComponentProps<typeof FeedEntries>, "entries" | "endsFeed">) {
  const runs = useMemo(
    () => groupTurnActivity(turn, feedProps.threadResponsePresentation),
    [turn, feedProps.threadResponsePresentation],
  );
  return (
    <>
      {runs.map((run, runIndex) => {
        const content = (
          <FeedEntries {...feedProps} entries={run.entries} endsFeed={isLatestTurn && runIndex === runs.length - 1} />
        );
        return (
          <div
            key={run.key}
            className={
              run.activity
                ? "space-y-2 border-l border-cc-border/70 pl-7 sm:space-y-3 sm:pl-9"
                : "space-y-2 sm:space-y-3"
            }
            data-turn-activity={run.activity ? "true" : undefined}
          >
            {run.activity ? <HidePawContext.Provider value={true}>{content}</HidePawContext.Provider> : content}
          </div>
        );
      })}
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
  activeNeedsInputAnchorMessageIds,
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
  activeNeedsInputAnchorMessageIds: ReadonlySet<string>;
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
  const threadQuest = useQuestRecord(threadQuestId);
  const completedAt = threadQuest?.status === "done" ? threadQuest.completedAt : null;
  const completionSummaryHost = useMemo(
    () =>
      threadQuestId
        ? questCompletionSummaryHost(turns, threadQuestId, completedAt, hasOlderSections, hasNewerSections)
        : null,
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
        const turnResponsePresentation =
          threadResponsePresentation && readyThreadResponseAppliesToTurn(turn, threadResponsePresentation)
            ? threadResponsePresentation
            : null;
        const collapsedThreadResponsePresentation =
          turnResponsePresentation &&
          (readyThreadResponsePresentation || threadResponsePresentationTouchesTurn(turn, turnResponsePresentation))
            ? turnResponsePresentation
            : null;
        const collapsedShowsMessage = collapsedThreadResponsePresentation
          ? readyThreadResponseTurnHasMessage(
              turn,
              collapsedThreadResponsePresentation,
              activeNeedsInputAnchorMessageIds,
            )
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
            ? readyThreadResponseTurnHasContent(
                turn,
                collapsedThreadResponsePresentation,
                activeNeedsInputAnchorMessageIds,
              )
            : (turn.collapsedEntries?.some((row) => row.kind === "entry") ?? false) || turn.subConclusions.length > 0);
        const hasCollapsedCurrentAnswer =
          collapsedThreadResponsePresentation?.currentResponses.some((item) => item.sourceTurnId === turn.id) ?? false;
        const turnSummaryDuration = getTurnSummaryDurationMs(turn);
        const showThreadStatusFooter = turn.id === threadStatusFooterTurnId;
        const isCompletionHost = completionSummaryHost?.turnId === turn.id;
        const completionSummaryCard =
          threadQuestId && isCompletionHost && !completionSummaryHost.withQuiz ? (
            <div className="min-w-0 pl-9">
              <QuestCompletionSummaryCard
                questId={threadQuestId}
                sessionId={sessionId}
                questLinkSurface={questLinkSurface}
              />
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

        return (
          <QuestCompletionSummaryContext.Provider
            key={turn.id}
            value={isCompletionHost && completionSummaryHost.withQuiz ? threadQuestId : null}
          >
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
                        <div className="flex-1 min-w-0 rounded-xl border border-cc-border/20 bg-cc-card/20 overflow-hidden">
                          {!collapsedThreadResponsePresentation && turn.subConclusions.length > 0 && (
                            <div className="px-3 pt-2 space-y-1.5">
                              <HidePawContext.Provider value={true}>
                                {turn.subConclusions.map((sc, scIdx) => (
                                  <FeedEntries
                                    key={scIdx}
                                    entries={[sc.entry]}
                                    sessionId={sessionId}
                                    currentThreadKey={currentThreadKey}
                                    isCodexSession={isCodexSession}
                                    activeCodexTerminalIds={activeCodexTerminalIds}
                                    onOpenCodexTerminal={onOpenCodexTerminal}
                                    onSelectThread={onSelectThread}
                                    questLinkSurface={questLinkSurface}
                                  />
                                ))}
                              </HidePawContext.Provider>
                            </div>
                          )}
                          <CollapsedTurnRows
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
                            activeNeedsInputAnchorMessageIds={activeNeedsInputAnchorMessageIds}
                            preserveHostQuestQuiz={preserveHostQuestQuiz}
                            unansweredMessageEntry={unansweredMessageEntry}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
                {(!isActivityExpanded || turnPresentationEntries(turn).length === 0) && threadStatusFooter}
              </div>
            </div>
          </QuestCompletionSummaryContext.Provider>
        );
      })}
    </InlineMessageTimingVisibilityContext.Provider>
  );
});
