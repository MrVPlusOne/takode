import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
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
import { DiffChip, QuestDiffChips } from "./DiffChip.js";
import { SideQuestIcon } from "./SideQuestCue.js";
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

function QuestJourneyHoverTarget({
  row,
  details,
  children,
}: {
  row: QuestThreadBannerRow;
  /** The quest's Worker, commits and Notify, shown under its Journey in the card. */
  details?: ReactNode;
  children: ReactNode;
}) {
  const hasCard = !!row.journey?.phaseIds?.length || !!details;
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The input of the latest press or hover. A tap toggles the card; a mouse
  // hovers it open. A tap also emulates mouseenter before its click, which
  // must not count as a hover or the click would close what it just opened.
  const pointerTypeRef = useRef("mouse");
  const notePointerType = (event: PointerEvent<HTMLDivElement>) => {
    pointerTypeRef.current = event.pointerType || "mouse";
  };
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
    if (!hasCard) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHoverRect(target.getBoundingClientRect());
  }

  function showPreview(event: MouseEvent<HTMLDivElement>) {
    if (pointerTypeRef.current !== "mouse") return;
    showPreviewForTarget(event.currentTarget);
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (pointerTypeRef.current !== "mouse" && hoverRect) {
      setHoverRect(null);
      return;
    }
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
        onPointerEnter={notePointerType}
        onPointerDown={notePointerType}
        onMouseEnter={showPreview}
        onMouseLeave={scheduleHidePreview}
        onClick={handleClick}
        onKeyDown={handlePreviewKeyDown}
        role={hasCard ? "button" : undefined}
        tabIndex={hasCard ? 0 : undefined}
        aria-label={hasCard ? "Show Quest Journey preview" : undefined}
        aria-haspopup={hasCard ? "dialog" : undefined}
        aria-expanded={hoverRect ? "true" : "false"}
        data-testid="quest-thread-journey-hover-target"
        data-touch-preview={hasCard ? "true" : "false"}
      >
        {children}
      </div>
      {hasCard &&
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
              {row.journey ? (
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
              ) : (
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono-code text-[11px] text-cc-info">
                    {row.questId ?? row.threadKey}
                  </span>
                  {row.title && <span className="min-w-0 truncate text-xs font-medium text-cc-fg">{row.title}</span>}
                </div>
              )}
              {details && (
                <div
                  className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 border-t border-cc-border/50 pt-2"
                  data-testid="quest-thread-pill-details"
                >
                  {details}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

type QuestBannerVariant = "thread" | "session";

export type QuestBannerParticipantRole = "Worker" | "Reviewer" | "Leader";

type QuestBannerWaitCondition = { kind: "queued"; refs: string[] } | { kind: "user-input"; refs: string[] };

type QuestBannerQueuedWaitCondition = Extract<QuestBannerWaitCondition, { kind: "queued" }>;

/** A leader, worker or reviewer chip: status dot, role, #N and host; opens that session. */
export function QuestBannerParticipantChip({
  role,
  participant,
  sessionId: explicitSessionId,
  fallbackSessionId,
  fallbackSessionNum,
  currentSessionId,
  threadKey,
  showDisplayName = true,
  variant = "session",
  onNavigate,
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
  onNavigate?: () => void;
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
      onNavigate={onNavigate}
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

/** Open leader questions to the user that do not pause Work (shown while the quest is not waiting). */
function QuestBannerOpenQuestionsPill({ count }: { count: number }) {
  const label = `${count} open question${count === 1 ? "" : "s"} for you`;
  return (
    <span
      className="inline-flex min-h-5 shrink-0 items-center rounded-full border border-cc-border/55 bg-cc-hover/20 px-1.5 py-0.5 text-[10px] leading-none text-cc-muted"
      data-testid="quest-thread-open-questions-pill"
      title={`${label}; Work continues while they are open`}
    >
      {label}
    </span>
  );
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
  onCloseTab,
  sideQuestOf,
  leading,
  singleLine = false,
}: {
  /** Shown before the quest ID: the quest's topic, as the way to zoom out to it. */
  leading?: ReactNode;
  /**
   * Desktop with the thread navigation in the top bar: keep the strip to one line. The title
   * truncates first; in a narrow chat column the details drop words their icons already say.
   */
  singleLine?: boolean;
  row?: QuestThreadBannerRow;
  threadKey: string;
  /** Set when this quest is a side quest: the thread ("main" or a quest ID) where its answer is given. */
  sideQuestOf?: string;
  variant?: QuestBannerVariant;
  currentSessionId?: string;
  monitorSessionId?: string;
  /** Session whose diff chip this banner holds; the chip opens that session's diff target for this thread. */
  diffSessionId?: string;
  /** Closes the thread tab this strip names; only passed while that tab can close. */
  onCloseTab?: () => void;
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
  const openQuestionCount =
    waitCondition || (row && isDoneThreadRow(row)) ? 0 : compactStringList(row?.boardRow?.openQuestions).length;
  const hasParticipantContext = isSessionBanner
    ? !!(row?.leaderSessionId || row?.rowStatus?.reviewer)
    : !!(row?.rowStatus?.worker || row?.boardRow?.worker || row?.rowStatus?.reviewer);
  // Done quests already read as finished, so only an unfinished quest needs "Not on board".
  const ownership =
    isSessionBanner || (row?.ownership === "off-board" && isDoneThreadRow(row)) ? undefined : row?.ownership;
  const ledElsewhere = ownership === "other-leader";
  // A quest thread's strip keeps one line: its Worker and commits are in the phase pill's card,
  // one hover or tap away, and Notify Me is an icon. A worker's own quest banner keeps its chips.
  // A status pill shows (and can hold the details card) once the quest's status or wait is known.
  const hasPill = !!(row?.status || queuedWaitCondition);
  const pillDetails = isSessionBanner ? undefined : (
    <>
      {hasParticipantContext && (
        <>
          <QuestBannerParticipantChip
            role="Worker"
            variant="thread"
            participant={boardWorkerParticipantForRow(row)}
            fallbackSessionId={row?.boardRow?.worker}
            fallbackSessionNum={row?.boardRow?.workerNum}
            showDisplayName={false}
          />
          <QuestBannerParticipantChip
            role="Reviewer"
            participant={row?.rowStatus?.reviewer}
            showDisplayName={false}
            variant="thread"
          />
        </>
      )}
      {showCommitAffordance && (
        <QuestDiffChips
          sessionId={diffSessionId}
          threadKey={threadKey}
          fallbackCommitShas={row?.commitShas}
          testId="quest-thread-diff-chip"
        />
      )}
    </>
  );
  const hasMeta =
    !!waitCondition ||
    openQuestionCount > 0 ||
    !!row?.journey ||
    !!row?.status ||
    !!ownership ||
    hasParticipantContext ||
    showCommitAffordance;
  const hasMobileDetails =
    (showCommitAffordance && isSessionBanner) ||
    !!queuedWaitCondition ||
    openQuestionCount > 0 ||
    (isSessionBanner && (!!inputWaitCondition || !!(row?.leaderSessionId && row.leaderSessionId !== currentSessionId)));
  return (
    <div
      className={`shrink-0 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-1 sm:px-3 ${singleLine ? "@container/quest-strip sm:flex sm:min-h-8 sm:flex-col sm:justify-center sm:py-0.5" : ""}`}
      data-testid="quest-thread-banner"
      data-variant={variant}
      data-layout="compact-inline"
      data-mobile-collapsed={collapsed}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-x-1 gap-y-0.5 text-xs sm:flex sm:items-start sm:gap-x-2">
        {/* On wider screens everything but the close button wraps here, so the button keeps the top right corner. */}
        <div
          className="contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-0.5"
          data-testid="quest-thread-wrapping-content"
        >
          <div
            className={`col-start-1 row-start-1 inline-flex min-w-0 max-w-full gap-1.5 ${
              // One line: the title gives way down to a few words before the details wrap.
              singleLine ? "items-center sm:min-w-min sm:flex-[1_1_0%]" : "items-baseline sm:flex-[1_1_16rem]"
            }`}
          >
            {leading}
            {isSessionBanner && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/65">
                Quest
              </span>
            )}
            <QuestInlineLink
              questId={questId}
              className="cc-quest-link shrink-0 font-mono-code font-medium hover:underline"
            >
              {questId}
            </QuestInlineLink>
            {sideQuestOf && (
              <span className="inline-flex shrink-0 self-center text-cc-muted">
                <SideQuestIcon sideQuestOf={sideQuestOf} />
              </span>
            )}
            {title && (
              <span
                className={`truncate text-xs font-medium text-cc-fg sm:text-[13px] ${singleLine ? "min-w-[6rem]" : "min-w-0"}`}
                title={title}
              >
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
          {monitorSessionId && !isSessionBanner && (
            // Right before the phase pill on phones and desktop, as one icon: the strip stays one line.
            <span className="col-start-3 row-start-1 inline-flex shrink-0" data-testid="quest-thread-notify">
              <NotifyMeControl
                sessionId={monitorSessionId}
                threadKey={threadKey}
                iconOnly
                // A 32 px target on phones, as the close button, without growing the strip.
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md max-sm:-my-1 max-sm:h-8 max-sm:w-8"
              />
            </span>
          )}
          {hasMeta && (
            <div
              className="contents min-w-0 flex-[1_1_auto] flex-wrap items-center gap-1.5 sm:inline-flex sm:flex-[0_1_auto] sm:justify-end"
              data-testid="quest-thread-meta-strip"
            >
              <div
                className={`col-start-4 row-start-1 inline-flex min-w-0 items-center gap-1 justify-self-end ${queuedWaitCondition ? "sm:hidden" : "sm:contents"}`}
              >
                {ownership && (
                  <QuestThreadOwnershipChip
                    ownership={ownership}
                    leaderSessionId={row?.leaderSessionId}
                    fallbackLeaderSessionNum={row?.leaderSessionNum}
                    questId={questId}
                  />
                )}
                {row && (row.journey || (pillDetails && hasPill)) ? (
                  <QuestJourneyHoverTarget row={row} details={pillDetails}>
                    {row?.journey ? (
                      <QuestJourneyTimeline
                        journey={row.journey}
                        status={journeyStatusForThread(row)}
                        variant="compact"
                        showNotes={false}
                        compactOptions={QUEST_HEADER_JOURNEY_OPTIONS}
                        className={`whitespace-nowrap rounded-full border border-cc-border/55 bg-cc-hover/20 px-1.5 py-0.5 ${ledElsewhere ? "opacity-60" : ""}`}
                      />
                    ) : (
                      <QuestStatusFallbackPill status={queuedWaitCondition ? "Queued" : row?.status} />
                    )}
                  </QuestJourneyHoverTarget>
                ) : (
                  <QuestStatusFallbackPill status={queuedWaitCondition ? "Queued" : row?.status} />
                )}
              </div>
              <div
                id={detailsId}
                data-testid="quest-thread-details"
                className={`${collapsed ? "hidden" : "flex"} col-span-5 min-w-0 flex-wrap items-center gap-1.5 sm:contents`}
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
                {openQuestionCount > 0 && <QuestBannerOpenQuestionsPill count={openQuestionCount} />}
                {hasParticipantContext && isSessionBanner && (
                  <div
                    className="inline-flex min-w-0 items-center gap-1.5"
                    data-testid="quest-thread-participant-strip"
                  >
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
                  </div>
                )}
                {showCommitAffordance && isSessionBanner && (
                  <DiffChip
                    sessionId={diffSessionId}
                    threadKey={MAIN_THREAD_KEY}
                    fallbackCommitShas={row?.commitShas}
                    testId="quest-thread-diff-chip"
                  />
                )}
                {/* With no pill to hover yet (the quest's record hasn't arrived), its details stay in the strip. */}
                {!(row && (row.journey || hasPill)) && pillDetails}
              </div>
            </div>
          )}
        </div>
        {onCloseTab && (
          // Closing the tab on screen without opening its group to find it.
          <button
            type="button"
            // 32 px to tap easily on a phone; the negative margin keeps the strip's height.
            className="col-start-5 row-start-1 -my-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg focus-visible:outline focus-visible:outline-cc-primary"
            aria-label={`Close the ${questId} tab`}
            title="Close tab"
            onClick={onCloseTab}
            data-testid="quest-thread-close-tab"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
