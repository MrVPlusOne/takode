import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { formatWaitForRefLabel, getWaitForRefKind } from "../../shared/quest-journey.js";
import { NotifyMeControl } from "./NotifyMe.js";
import type { BoardRowData } from "./BoardTable.js";
import {
  isCompletedJourneyPresentationStatus,
  QuestJourneyPreviewCard,
  QuestJourneyTimeline,
} from "./QuestJourneyTimeline.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { QuestThreadOwnershipChip } from "./QuestThreadOwnership.js";
import { SessionStatusDot } from "./SessionStatusDot.js";
import { SessionHostBadge } from "./HostBadge.js";
import { useParticipantSessionStatusDotProps } from "./session-participant-status.js";
import {
  QUEST_PARTICIPANT_CHIP_CLASS,
  QUEST_PARTICIPANT_NAME_CLASS,
  QUEST_PARTICIPANT_SESSION_CLASS,
} from "./quest-participant-chip-style.js";
import { SessionRoleLabel } from "./SessionRoleLabel.js";
import { DiffChip } from "./DiffChip.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { getQuestStatusTheme } from "../utils/quest-status-theme.js";
import { resolveSessionNavigation, type ResolvedSessionNavigation } from "../utils/session-navigation-resolver.js";
import type { QuestThreadBannerRow } from "../utils/session-quest-banner-row.js";
import type { BoardRowSessionStatus } from "../types.js";

export type { QuestThreadBannerRow } from "../utils/session-quest-banner-row.js";

export function isDoneThreadRow(row: QuestThreadBannerRow): boolean {
  return (
    row.boardRow?.completedAt !== undefined ||
    isCompletedJourneyPresentationStatus(row.status) ||
    isCompletedJourneyPresentationStatus(row.boardStatus)
  );
}

function journeyStatusForThread(row: QuestThreadBannerRow): string | undefined {
  return isDoneThreadRow(row) ? "done" : row.boardStatus;
}

function QuestJourneyHoverTarget({ row, children }: { row: QuestThreadBannerRow; children: ReactNode }) {
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const cardWidth = Math.min(380, (window.innerWidth - 16) / zoomLevel);
  const gap = 6;

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!cardRef.current || !hoverRect) return;
    const rect = cardRef.current.getBoundingClientRect();
    const el = cardRef.current;
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - cardWidth - 8)}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${Math.max(8, hoverRect.top - rect.height - gap)}px`;
    }
    if (rect.top < 8) {
      el.style.top = "8px";
    }
  }, [hoverRect]);

  function showPreviewForTarget(target: HTMLElement) {
    if (!row.journey?.phaseIds?.length) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHoverRect(target.getBoundingClientRect());
  }

  function showPreview(event: MouseEvent<HTMLDivElement>) {
    showPreviewForTarget(event.currentTarget);
  }

  function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    showPreviewForTarget(event.currentTarget);
  }

  function scheduleHidePreview() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHoverRect(null), 100);
  }

  return (
    <>
      <div
        className="inline-flex max-w-full min-w-0"
        onMouseEnter={showPreview}
        onMouseLeave={scheduleHidePreview}
        onClick={(event) => showPreviewForTarget(event.currentTarget)}
        onKeyDown={handlePreviewKeyDown}
        role={row.journey?.phaseIds?.length ? "button" : undefined}
        tabIndex={row.journey?.phaseIds?.length ? 0 : undefined}
        aria-label={row.journey?.phaseIds?.length ? "Show Quest Journey preview" : undefined}
        aria-haspopup={row.journey?.phaseIds?.length ? "dialog" : undefined}
        aria-expanded={hoverRect ? "true" : "false"}
        data-testid="quest-thread-journey-hover-target"
        data-touch-preview={row.journey?.phaseIds?.length ? "true" : "false"}
      >
        {children}
      </div>
      {row.journey &&
        hoverRect &&
        createPortal(
          <div
            ref={cardRef}
            className="fixed z-50 pointer-events-auto"
            style={{
              left: hoverRect.left,
              top: hoverRect.bottom + gap,
              width: cardWidth,
              transform: `scale(${zoomLevel})`,
              transformOrigin: "top left",
            }}
            onMouseEnter={() => {
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            }}
            onMouseLeave={() => setHoverRect(null)}
            data-testid="quest-thread-journey-hover-card"
          >
            <div className="rounded-lg border border-cc-border bg-cc-card p-2.5 shadow-xl">
              <QuestJourneyPreviewCard
                journey={row.journey}
                status={journeyStatusForThread(row)}
                durationSummary={row.journeyDurationSummary}
                quest={{
                  questId: row.questId ?? row.threadKey,
                  title: row.title,
                }}
                onQuestClick={() => useStore.getState().openQuestOverlay(row.questId ?? row.threadKey)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

type QuestBannerVariant = "thread" | "session";

type QuestBannerParticipantRole = "Worker" | "Reviewer" | "Leader";

type QuestBannerWaitCondition = { kind: "queued"; refs: string[] } | { kind: "user-input"; refs: string[] };

type QuestBannerQueuedWaitCondition = Extract<QuestBannerWaitCondition, { kind: "queued" }>;

function QuestBannerParticipantChip({
  role,
  participant,
  sessionId: explicitSessionId,
  fallbackSessionId,
  fallbackSessionNum,
  currentSessionId,
  threadKey,
  showDisplayName = true,
  variant = "session",
}: {
  role: QuestBannerParticipantRole;
  participant?: BoardRowSessionStatus["worker"] | BoardRowSessionStatus["reviewer"] | null;
  sessionId?: string | null;
  fallbackSessionId?: string;
  fallbackSessionNum?: number;
  currentSessionId?: string;
  threadKey?: string | null;
  showDisplayName?: boolean;
  variant?: QuestBannerVariant;
}) {
  const candidateSessionId = participant?.sessionId ?? explicitSessionId ?? fallbackSessionId ?? null;
  const candidateSessionNum = participant?.sessionNum ?? fallbackSessionNum ?? undefined;
  const resolvedNavigation = useStore((s) => {
    if (candidateSessionId) return resolveSessionNavigation(s, candidateSessionId);
    if (candidateSessionNum == null) return null;
    for (const sdkSession of s.sdkSessions) {
      const candidate = resolveSessionNavigation(s, sdkSession.sessionId);
      if (participantNavigationMatchesSessionNum(candidate, sdkSession.sessionNum, candidateSessionNum)) {
        return candidate;
      }
    }
    return null;
  });
  const sessionId = candidateSessionId ?? resolvedNavigation?.viewModel.sessionId ?? null;
  const { sessionNum, displayName } = resolveQuestBannerParticipantIdentity(
    resolvedNavigation,
    candidateSessionNum,
    participant?.name,
  );
  const dotProps = useParticipantSessionStatusDotProps(sessionId, participant?.status);
  if (currentSessionId && sessionId === currentSessionId) return null;
  if (!sessionId && sessionNum == null) return null;
  const label = `${role} #${sessionNum ?? "?"}${displayName ? ` ${displayName}` : ""}`;
  const content = (
    <>
      {dotProps && <SessionStatusDot className="mt-0" {...dotProps} />}
      <SessionRoleLabel role={role} />
      <span className={QUEST_PARTICIPANT_SESSION_CLASS}>{`#${sessionNum ?? "?"}`}</span>
      {sessionId && <SessionHostBadge sessionId={sessionId} />}
      {showDisplayName && displayName && <span className={QUEST_PARTICIPANT_NAME_CLASS}>{displayName}</span>}
    </>
  );

  return (
    <SessionInlineLink
      sessionId={sessionId}
      sessionNum={sessionNum}
      className={
        variant === "thread"
          ? `inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded px-1 text-[11px] hover:bg-cc-hover focus-visible:outline focus-visible:outline-cc-primary ${role === "Reviewer" ? "text-cc-muted" : "font-medium text-cc-fg"}`
          : QUEST_PARTICIPANT_CHIP_CLASS
      }
      dataTestId="quest-thread-participant"
      ariaLabel={label}
      title={`Open ${role.toLowerCase()} session ${sessionNum != null ? `#${sessionNum}` : sessionId}${displayName ? ` ${displayName}` : ""}`}
      threadKey={threadKey}
    >
      {content}
    </SessionInlineLink>
  );
}

export function participantNavigationMatchesSessionNum(
  navigation: ResolvedSessionNavigation | null,
  sdkSessionNum: number | null | undefined,
  targetSessionNum: number,
): boolean {
  return navigation ? navigation.viewModel.sessionNum === targetSessionNum : sdkSessionNum === targetSessionNum;
}

export function resolveQuestBannerParticipantIdentity(
  navigation: ResolvedSessionNavigation | null,
  fallbackSessionNum?: number,
  fallbackName?: string,
): { sessionNum?: number; displayName?: string } {
  return navigation
    ? {
        sessionNum: navigation.viewModel.sessionNum ?? undefined,
        displayName: navigation.sidebarItem.name,
      }
    : { sessionNum: fallbackSessionNum, displayName: fallbackName };
}

function boardWorkerParticipantForRow(row?: QuestThreadBannerRow): BoardRowSessionStatus["worker"] | undefined {
  const participant = row?.rowStatus?.worker;
  const boardWorkerId = row?.boardRow?.worker;
  const boardWorkerNum = row?.boardRow?.workerNum;
  if (!boardWorkerId && boardWorkerNum == null) return participant;
  if (!participant) return undefined;
  if (boardWorkerId && participant.sessionId === boardWorkerId) return participant;
  if (boardWorkerNum != null && participant.sessionNum === boardWorkerNum) return participant;
  return undefined;
}

// The header chip shares a row with the quest title, so it uses the shorter
// finished label and drops the phase total on phones to leave the title room.
const QUEST_HEADER_JOURNEY_OPTIONS = {
  completedLabel: "Done",
  hidePhaseTotalOnNarrow: true,
} as const;

function QuestStatusFallbackPill({ status }: { status?: string }) {
  if (!status) return null;
  const statusTheme = getQuestStatusTheme(status);
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] leading-none ${statusTheme.bg} ${statusTheme.text} ${statusTheme.border}`}
      data-testid="quest-banner-status-pill"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusTheme.dot}`} />
      {statusTheme.label}
    </span>
  );
}

function isQueuedBoardRowStatus(status?: string): boolean {
  return (status ?? "").trim().toUpperCase() === "QUEUED";
}

function compactStringList(values: ReadonlyArray<string> | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function waitConditionForBoardRow(row?: BoardRowData): QuestBannerWaitCondition | null {
  if (!row) return null;
  if (isQueuedBoardRowStatus(row.status)) {
    const refs = compactStringList(row.waitFor);
    return refs.length > 0 ? { kind: "queued", refs } : null;
  }
  const refs = compactStringList(row.waitForInput);
  return refs.length > 0 ? { kind: "user-input", refs } : null;
}

function waitForInputLabel(notificationId: string): string {
  const match = /^n-(\d+)$/i.exec(notificationId);
  return `user input ${match ? match[1] : notificationId}`;
}

function waitConditionTitle(condition: QuestBannerWaitCondition): string {
  const labels =
    condition.kind === "queued" ? condition.refs.map(formatWaitForRefLabel) : condition.refs.map(waitForInputLabel);
  return `Waiting for ${labels.join(", ")}`;
}

function queuedWaitStatusTitle(condition: QuestBannerQueuedWaitCondition): string {
  return waitConditionTitle(condition).replace(/^Waiting for /, "Queued, waiting for ");
}

function QuestBannerQueuedWaitRef({ depRef }: { depRef: string }) {
  const kind = getWaitForRefKind(depRef);
  if (kind === "session") {
    const sessionNum = Number.parseInt(depRef.slice(1), 10);
    const session = useStore((s) => s.sdkSessions.find((candidate) => candidate.sessionNum === sessionNum));
    if (!session) return <span className="font-mono-code text-cc-attention">{depRef}</span>;
    return (
      <SessionInlineLink
        sessionId={session.sessionId}
        sessionNum={sessionNum}
        className="font-mono-code text-cc-attention hover:text-cc-attention-strong hover:underline decoration-dotted underline-offset-2"
        title={`Open waiting session #${sessionNum}`}
        stopPropagation
      >
        {depRef}
      </SessionInlineLink>
    );
  }
  if (kind === "quest") {
    return (
      <QuestInlineLink
        questId={depRef}
        className="font-mono-code text-cc-attention hover:text-cc-attention-strong hover:underline decoration-dotted underline-offset-2"
        stopPropagation
      >
        {depRef}
      </QuestInlineLink>
    );
  }
  return <span className="text-cc-attention">{formatWaitForRefLabel(depRef)}</span>;
}

function QuestBannerWaitRef({ condition, refValue }: { condition: QuestBannerWaitCondition; refValue: string }) {
  if (condition.kind === "queued") return <QuestBannerQueuedWaitRef depRef={refValue} />;
  return <span className="text-cc-attention">{waitForInputLabel(refValue)}</span>;
}

function QuestBannerWaitPill({ condition }: { condition: QuestBannerWaitCondition }) {
  return (
    <span
      className="inline-flex min-h-5 min-w-0 max-w-full shrink flex-wrap items-center gap-x-1 gap-y-0.5 rounded-full border border-cc-attention/35 bg-cc-attention/10 px-1.5 py-0.5 text-[10px] leading-none text-cc-attention"
      data-testid="quest-thread-wait-pill"
      title={waitConditionTitle(condition)}
    >
      <span className="shrink-0 font-medium">Waiting for </span>
      <span className="inline-flex min-w-0 flex-wrap items-center">
        {condition.refs.map((refValue, index) => (
          <Fragment key={`${condition.kind}-${refValue}`}>
            {index > 0 && <span className="text-cc-muted/70">, </span>}
            <QuestBannerWaitRef condition={condition} refValue={refValue} />
          </Fragment>
        ))}
      </span>
    </span>
  );
}

function QuestBannerQueuedStatusChip({ condition }: { condition: QuestBannerQueuedWaitCondition }) {
  return (
    <span
      className="inline-flex min-h-5 min-w-0 max-w-full shrink flex-wrap items-center gap-x-1 gap-y-0.5 rounded-full border border-cc-border/55 bg-cc-hover/20 px-1.5 py-0.5 text-[10px] leading-none text-cc-fg"
      data-testid="quest-thread-queued-status-chip"
      title={queuedWaitStatusTitle(condition)}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-cc-attention/45 bg-cc-attention/55" />
      <span className="shrink-0 font-medium">Queued, waiting for </span>
      <span className="inline-flex min-w-0 flex-wrap items-center">
        {condition.refs.map((refValue, index) => (
          <Fragment key={`${condition.kind}-${refValue}`}>
            {index > 0 && <span className="text-cc-muted/70">, </span>}
            <QuestBannerWaitRef condition={condition} refValue={refValue} />
          </Fragment>
        ))}
      </span>
    </span>
  );
}

export function QuestThreadBanner({
  row,
  threadKey,
  variant = "thread",
  currentSessionId,
  monitorSessionId,
  diffSessionId,
}: {
  row?: QuestThreadBannerRow;
  threadKey: string;
  variant?: QuestBannerVariant;
  currentSessionId?: string;
  monitorSessionId?: string;
  /** Session whose diff chip this banner holds; the chip opens that session's diff target for this thread. */
  diffSessionId?: string;
}) {
  const questId = row?.questId ?? threadKey.toLowerCase();
  const [collapsed, setCollapsed] = useState(false);
  const detailsId = useId();
  // Disclosure belongs to this quest, not to its changing phase or participants.
  useEffect(() => setCollapsed(false), [questId]);
  const title = row?.title;
  const isSessionBanner = variant === "session";
  const showCommitAffordance = !!diffSessionId;
  const waitCondition = row && isDoneThreadRow(row) ? null : waitConditionForBoardRow(row?.boardRow);
  const queuedWaitCondition = waitCondition?.kind === "queued" ? waitCondition : null;
  const inputWaitCondition = waitCondition?.kind === "user-input" ? waitCondition : null;
  const hasParticipantContext = isSessionBanner
    ? !!(row?.leaderSessionId || row?.rowStatus?.reviewer)
    : !!(row?.rowStatus?.worker || row?.boardRow?.worker || row?.rowStatus?.reviewer);
  // Done quests already read as finished, so only an unfinished quest needs "Not on board".
  const ownership =
    isSessionBanner || (row?.ownership === "off-board" && isDoneThreadRow(row)) ? undefined : row?.ownership;
  const ledElsewhere = ownership === "other-leader";
  const hasMeta =
    !!waitCondition || !!row?.journey || !!row?.status || !!ownership || hasParticipantContext || showCommitAffordance;
  const hasMobileDetails =
    showCommitAffordance ||
    !!queuedWaitCondition ||
    (isSessionBanner && (!!inputWaitCondition || !!(row?.leaderSessionId && row.leaderSessionId !== currentSessionId)));
  return (
    <div
      className="shrink-0 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-1 sm:px-3"
      data-testid="quest-thread-banner"
      data-variant={variant}
      data-layout="compact-inline"
      data-mobile-collapsed={collapsed}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 gap-y-0.5 text-xs sm:flex sm:flex-wrap sm:gap-x-2">
        <div className="col-start-1 row-start-1 inline-flex min-w-0 max-w-full items-baseline gap-1.5 sm:flex-[1_1_16rem]">
          {isSessionBanner && (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/65">Quest</span>
          )}
          <QuestInlineLink
            questId={questId}
            className="cc-quest-link shrink-0 font-mono-code font-medium hover:underline"
          >
            {questId}
          </QuestInlineLink>
          {title && (
            <span className="min-w-0 truncate text-xs font-medium text-cc-fg sm:text-[13px]" title={title}>
              {title}
            </span>
          )}
        </div>
        {hasMobileDetails && (
          <button
            type="button"
            className="col-start-2 row-start-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-cc-muted hover:bg-cc-hover hover:text-cc-fg focus-visible:outline focus-visible:outline-cc-primary sm:hidden"
            aria-label={collapsed ? "Expand quest information" : "Collapse quest information"}
            aria-expanded={!collapsed}
            aria-controls={detailsId}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path d={collapsed ? "m4 6 4 4 4-4" : "m4 10 4-4 4 4"} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {hasMeta && (
          <div
            className="contents min-w-0 flex-[1_1_auto] flex-wrap items-center gap-1.5 sm:inline-flex sm:flex-[0_1_auto] sm:justify-end"
            data-testid="quest-thread-meta-strip"
          >
            <div
              className={`col-start-3 row-start-1 inline-flex min-w-0 items-center gap-1 justify-self-end ${queuedWaitCondition ? "sm:hidden" : "sm:contents"}`}
            >
              {ownership && (
                <QuestThreadOwnershipChip
                  ownership={ownership}
                  leaderSessionId={row?.leaderSessionId}
                  fallbackLeaderSessionNum={row?.leaderSessionNum}
                  questId={questId}
                />
              )}
              {row?.journey ? (
                <QuestJourneyHoverTarget row={row}>
                  <QuestJourneyTimeline
                    journey={row.journey}
                    status={journeyStatusForThread(row)}
                    variant="compact"
                    showNotes={false}
                    compactOptions={QUEST_HEADER_JOURNEY_OPTIONS}
                    className={`whitespace-nowrap rounded-full border border-cc-border/55 bg-cc-hover/20 px-1.5 py-0.5 ${ledElsewhere ? "opacity-60" : ""}`}
                  />
                </QuestJourneyHoverTarget>
              ) : (
                <QuestStatusFallbackPill status={queuedWaitCondition ? "Queued" : row?.status} />
              )}
            </div>
            <div
              id={detailsId}
              data-testid="quest-thread-details"
              className={`${collapsed ? "hidden" : "flex"} col-span-3 min-w-0 flex-wrap items-center gap-1.5 sm:contents`}
            >
              {queuedWaitCondition &&
                (row?.journey ? (
                  <QuestJourneyHoverTarget row={row}>
                    <QuestBannerQueuedStatusChip condition={queuedWaitCondition} />
                  </QuestJourneyHoverTarget>
                ) : (
                  <QuestBannerQueuedStatusChip condition={queuedWaitCondition} />
                ))}
              {isSessionBanner && inputWaitCondition && <QuestBannerWaitPill condition={inputWaitCondition} />}
              {hasParticipantContext && (
                <div className="inline-flex min-w-0 items-center gap-1.5" data-testid="quest-thread-participant-strip">
                  {isSessionBanner ? (
                    <>
                      <QuestBannerParticipantChip
                        role="Leader"
                        variant="thread"
                        showDisplayName={false}
                        sessionId={row?.leaderSessionId}
                        fallbackSessionNum={row?.leaderSessionNum ?? undefined}
                        currentSessionId={currentSessionId}
                        threadKey={row?.questId}
                      />
                      <span className="hidden sm:contents">
                        <QuestBannerParticipantChip
                          role="Reviewer"
                          participant={row?.rowStatus?.reviewer}
                          currentSessionId={currentSessionId}
                        />
                      </span>
                    </>
                  ) : (
                    <>
                      <QuestBannerParticipantChip
                        role="Worker"
                        variant="thread"
                        participant={boardWorkerParticipantForRow(row)}
                        fallbackSessionId={row?.boardRow?.worker}
                        fallbackSessionNum={row?.boardRow?.workerNum}
                        showDisplayName={false}
                      />
                      <span className="hidden sm:contents">
                        <QuestBannerParticipantChip
                          role="Reviewer"
                          participant={row?.rowStatus?.reviewer}
                          showDisplayName={false}
                          variant="thread"
                        />
                      </span>
                    </>
                  )}
                </div>
              )}
              {showCommitAffordance && (
                <DiffChip
                  sessionId={diffSessionId}
                  threadKey={isSessionBanner ? MAIN_THREAD_KEY : threadKey}
                  fallbackCommitShas={row?.commitShas}
                  testId="quest-thread-diff-chip"
                />
              )}
              {monitorSessionId && !isSessionBanner && (
                <NotifyMeControl sessionId={monitorSessionId} threadKey={threadKey} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
