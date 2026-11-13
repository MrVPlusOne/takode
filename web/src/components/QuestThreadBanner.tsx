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
import { SideQuestIcon, type SideQuestOf } from "./SideQuestCue.js";
import { MoveToSideButton, type MoveToSide } from "./ThreadStrip.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { getQuestStatusTheme } from "../utils/quest-status-theme.js";
import { resolveSessionNavigation, type ResolvedSessionNavigation } from "../utils/session-navigation-resolver.js";
import type { QuestThreadBannerRow } from "../utils/session-quest-banner-row.js";
import type { BoardRowSessionStatus } from "../types.js";
import { InlineThreadUpdate } from "./ThreadUpdate.js";
import { useThreadNews } from "./home/HomeExtras.js";

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
  closable = false,
  children,
}: {
  row: QuestThreadBannerRow;
  /** The quest's Worker, commits and Notify, shown under its Journey in the card. */
  details?: ReactNode;
  /** The card has an × and closes on a press outside it, as a drop-down opened by a tap. */
  closable?: boolean;
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

  const targetRef = useRef<HTMLDivElement>(null);
  const open = !!hoverRect;
  useEffect(() => {
    if (!closable || !open) return;
    const onPress = (event: globalThis.PointerEvent) => {
      const node = event.target as Node | null;
      if (cardRef.current?.contains(node) || targetRef.current?.contains(node)) return;
      setHoverRect(null);
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [closable, open]);

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
        ref={targetRef}
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
            <div
              className={`relative rounded-lg border border-cc-border bg-cc-card p-2.5 shadow-xl ${closable ? "pr-9" : ""}`}
            >
              {closable && (
                <button
                  type="button"
                  onClick={() => setHoverRect(null)}
                  className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
                  aria-label="Close"
                  data-testid="quest-thread-journey-card-close"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    className="h-3 w-3"
                    aria-hidden="true"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
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

/**
 * On a phone's breadcrumb band, the quest number goes when the title would get less than this
 * room (Jiayi: "hide quest number when space is not enough"); the quest's lists and card name it.
 */
const TITLE_ROOM_BEFORE_NUMBER_HIDES_PX = 192;

/**
 * Whether the quest number keeps its place before the title: false while the title, with the
 * number shown, would be cut short to under TITLE_ROOM_BEFORE_NUMBER_HIDES_PX. The room is worked
 * out for the number shown either way, so hiding it never flips the answer back.
 */
function useQuestNumberFits(
  enabled: boolean,
  numberRef: React.RefObject<HTMLElement | null>,
  titleRef: React.RefObject<HTMLElement | null>,
  title: string | undefined,
): boolean {
  const [fits, setFits] = useState(true);
  const numberWidthRef = useRef(0);
  useLayoutEffect(() => {
    const titleBox = titleRef.current;
    if (!enabled || !titleBox) {
      setFits(true);
      return;
    }
    const measure = () => {
      const number = numberRef.current;
      // 6 px: the gap the number takes with it.
      if (number && number.offsetWidth > 0) numberWidthRef.current = number.offsetWidth + 6;
      // The innermost truncating text: a picker's button holds its label, which is what gets cut.
      const text = [...titleBox.querySelectorAll<HTMLElement>(".truncate")].at(-1) ?? titleBox;
      setFits((shown) => {
        const room = text.clientWidth - (shown ? 0 : numberWidthRef.current);
        return !(room < text.scrollWidth && room < TITLE_ROOM_BEFORE_NUMBER_HIDES_PX);
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (titleBox.parentElement) observer.observe(titleBox.parentElement);
    return () => observer.disconnect();
  }, [enabled, numberRef, titleRef, title]);
  return fits;
}

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
  sideQuestOf,
  singleLine = false,
  onMoveToSide,
}: {
  /**
   * A leader's quest thread: the strip is one line holding only the thread's name and actions.
   * The quest's state (phase, worker, waits) floats in the feed instead (`QuestThreadFeedChips`).
   */
  singleLine?: boolean;
  /** Moves the thread into the side column; passed on desktop, where the column sits beside it. */
  onMoveToSide?: MoveToSide;
  row?: QuestThreadBannerRow;
  threadKey: string;
  /** Set when this quest is a side quest: the thread ("main" or a quest ID) where its answer is given. */
  sideQuestOf?: SideQuestOf;
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
  const news = useThreadNews(singleLine ? (monitorSessionId ?? diffSessionId) : undefined, questId);
  const questLink = (
    <QuestInlineLink questId={questId} className="cc-quest-link shrink-0 font-mono-code font-medium hover:underline">
      {questId}
    </QuestInlineLink>
  );
  const sideQuestIcon = sideQuestOf && (
    <span className="inline-flex shrink-0 self-center text-cc-muted">
      <SideQuestIcon sideQuestOf={sideQuestOf} />
    </span>
  );
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
  // A leader's thread carries its quest's state in the feed's chips, not on its strip.
  const metaInFeed = singleLine && !isSessionBanner;
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
    !metaInFeed &&
    (!!waitCondition ||
      openQuestionCount > 0 ||
      !!row?.journey ||
      !!row?.status ||
      !!ownership ||
      hasParticipantContext ||
      showCommitAffordance);
  const hasMobileDetails =
    !metaInFeed &&
    ((showCommitAffordance && isSessionBanner) ||
      !!queuedWaitCondition ||
      openQuestionCount > 0 ||
      (isSessionBanner &&
        (!!inputWaitCondition || !!(row?.leaderSessionId && row.leaderSessionId !== currentSessionId))));
  const numberRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const numberFits = useQuestNumberFits(singleLine, numberRef, titleRef, title);
  return (
    <div
      className={`relative shrink-0 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-1 sm:px-3 ${singleLine ? "@container/quest-strip sm:flex sm:min-h-8 sm:flex-col sm:justify-center sm:py-0.5" : ""}`}
      data-testid="quest-thread-banner"
      data-variant={variant}
      data-layout="compact-inline"
      data-mobile-collapsed={collapsed}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-x-1 gap-y-0.5 text-xs sm:flex sm:items-start sm:gap-x-2">
        {/* On wider screens everything but the close button wraps here, so the button keeps the top right corner. */}
        <div
          className={`contents sm:flex sm:min-w-0 sm:flex-1 sm:items-center sm:gap-x-2 sm:gap-y-0.5 ${
            // One line on the breadcrumb band: the topic, then the title, give way before anything wraps.
            singleLine ? "sm:flex-nowrap" : "sm:flex-wrap"
          }`}
          data-testid="quest-thread-wrapping-content"
        >
          <div
            className={`col-start-1 row-start-1 inline-flex min-w-0 max-w-full gap-1.5 ${
              singleLine ? "items-center sm:min-w-0 sm:flex-[1_1_0%]" : "items-baseline sm:flex-[1_1_16rem]"
            }`}
          >
            {isSessionBanner && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/65">
                Quest
              </span>
            )}
            {/* Boxes to measure on the breadcrumb band; elsewhere they add no layout of their own. */}
            <span
              ref={numberRef}
              className={singleLine ? `inline-flex shrink-0 ${numberFits ? "" : "max-sm:hidden"}` : "contents"}
            >
              {questLink}
            </span>
            {sideQuestIcon}
            <span ref={titleRef} className={singleLine ? "inline-flex min-w-0" : "contents"}>
              {title && (
                <span
                  className={`truncate text-xs font-medium text-cc-fg sm:text-[13px] ${singleLine ? "min-w-[6rem]" : "min-w-0"}`}
                  title={title}
                >
                  {title}
                </span>
              )}
            </span>
            {/* The leader's strip says what the thread's newest result is about, after its title. */}
            {singleLine && (
              <span className="flex min-w-0 flex-[1_1_0%] text-xs sm:text-[13px]">
                <InlineThreadUpdate text={news} />
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
                // A 32 px target on phones without growing the strip. Square with only the icon; with a
                // reminder set it widens to say when, on one line.
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 rounded-md px-0.5 text-[11px] max-sm:-my-1 max-sm:h-8 max-sm:min-w-8"
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
        {onMoveToSide && (
          <span className="col-start-4 row-start-1 inline-flex shrink-0 justify-self-end">
            <MoveToSideButton onMove={onMoveToSide} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A leader's quest thread shows its quest's state as chips floating at the top of its feed, not on
 * its strip: a thread is no longer tied to one quest or worker. The phase chip opens the Journey
 * card; the Worker and Reviewer chips open their sessions. An unfinished quest's chips fold into
 * one compact chip at the top right, its phase (whose dot already shows work going on) and a count
 * of open questions (Jiayi, Nov 1: on a phone they covered the conversation on two lines; desktop
 * followed the same evening); one tap opens the Journey card with the other chips under it. A
 * finished quest's few chips fit on one line and stay as they are.
 */
export function QuestThreadFeedChips({
  row,
  threadKey,
  diffSessionId,
}: {
  row?: QuestThreadBannerRow;
  threadKey: string;
  /** Session whose diff chip this holds, as on the strip it replaces. */
  diffSessionId?: string;
}) {
  if (!row) return null;
  const done = isDoneThreadRow(row);
  const waitCondition = done ? null : waitConditionForBoardRow(row.boardRow);
  const queued = waitCondition?.kind === "queued" ? waitCondition : null;
  const openQuestionCount = waitCondition || done ? 0 : compactStringList(row.boardRow?.openQuestions).length;
  const ownership = row.ownership === "off-board" && done ? undefined : row.ownership;
  const questId = row.questId ?? threadKey.toLowerCase();
  const working = !done && !!(row.rowStatus?.worker || row.boardRow?.worker);
  const groupClass =
    "pointer-events-auto inline-flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 self-start rounded-lg border border-cc-border/60 bg-cc-bg/90 px-1 py-0.5 text-xs shadow-sm backdrop-blur";
  const phaseChip = (className = "") =>
    row.journey ? (
      <QuestJourneyTimeline
        journey={row.journey}
        status={journeyStatusForThread(row)}
        variant="compact"
        showNotes={false}
        compactOptions={QUEST_HEADER_JOURNEY_OPTIONS}
        className={`whitespace-nowrap rounded-full border border-cc-border/55 bg-cc-hover/20 px-1.5 py-0.5 ${className}`}
      />
    ) : (
      <QuestStatusFallbackPill status={row.status} />
    );
  const otherChips = (
    <>
      {ownership && (
        <QuestThreadOwnershipChip
          ownership={ownership}
          leaderSessionId={row.leaderSessionId}
          fallbackLeaderSessionNum={row.leaderSessionNum}
          questId={questId}
        />
      )}
      {openQuestionCount > 0 && <QuestBannerOpenQuestionsPill count={openQuestionCount} />}
      {working && (
        <QuestBannerParticipantChip
          role="Worker"
          variant="thread"
          participant={boardWorkerParticipantForRow(row)}
          fallbackSessionId={row.boardRow?.worker}
          fallbackSessionNum={row.boardRow?.workerNum}
          showDisplayName={false}
        />
      )}
      {!done && (
        <QuestBannerParticipantChip
          role="Reviewer"
          participant={row.rowStatus?.reviewer}
          showDisplayName={false}
          variant="thread"
        />
      )}
      {diffSessionId && (
        <QuestDiffChips
          sessionId={diffSessionId}
          threadKey={threadKey}
          fallbackCommitShas={row.commitShas}
          testId="quest-thread-diff-chip"
        />
      )}
    </>
  );
  if (!done) {
    // One tap opens one drop-down: the Journey, and under it the worker, commits, changes and
    // waits, each still a button (Jiayi, Nov 1: folded chips that unfolded, then a second tap for
    // the Journey, took two taps).
    return (
      <div className={groupClass} data-testid="quest-thread-feed-chips-compact">
        <QuestJourneyHoverTarget
          row={row}
          closable
          details={
            <>
              {otherChips}
              {queued && <QuestBannerQueuedStatusChip condition={queued} />}
            </>
          }
        >
          <span className="inline-flex items-center gap-1">
            {openQuestionCount > 0 && <QuestBannerOpenQuestionsPill count={openQuestionCount} />}
            {queued ? <span className="whitespace-nowrap px-1 text-[10px] text-cc-fg">Queued</span> : phaseChip()}
          </span>
        </QuestJourneyHoverTarget>
      </div>
    );
  }
  // A finished quest: its commits and its Done phase chip, last at the feed's right edge.
  return (
    <div className={groupClass} data-testid="quest-thread-feed-chips">
      {otherChips}
      {row.journey ? (
        <QuestJourneyHoverTarget row={row}>
          {phaseChip(ownership === "other-leader" ? "opacity-60" : "")}
        </QuestJourneyHoverTarget>
      ) : (
        phaseChip()
      )}
    </div>
  );
}
