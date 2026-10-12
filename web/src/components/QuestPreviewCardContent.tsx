import { useMemo, type ReactNode } from "react";
import type { BoardParticipantStatus, QuestListPreview, QuestmasterTask } from "../types.js";
import type { QuestOwnerRef } from "../../shared/quest-owner.js";
import { getQuestRecordStatusTheme } from "../utils/quest-status-theme.js";
import { isQuestCancelled } from "../utils/quest-editor-helpers.js";
import { getQuestPhaseDotStyle } from "../utils/quest-phase-theme.js";
import { getQuestDisplayOwner, getQuestOwnerSessionId } from "../utils/quest-helpers.js";
import {
  findQuestJourneyContext,
  resolveQuestSessionTargets,
  type QuestJourneyBoardRow,
} from "../utils/quest-journey-context.js";
import { useStore } from "../store.js";
import {
  formatWaitForRefLabel,
  getQuestJourneyPhaseForState,
  getQuestJourneyPresentation,
} from "../../shared/quest-journey.js";
import { selectQuestPreviewProgressTldr } from "../../shared/quest-phase-documentation-summary.js";
import { isCompletedJourneyPresentationStatus, QuestJourneyPreviewCard } from "./QuestJourneyTimeline.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { SessionStatusDot } from "./SessionStatusDot.js";
import { useParticipantSessionStatusDotProps } from "./session-participant-status.js";
import {
  QUEST_PARTICIPANT_CHIP_CLASS,
  QUEST_PARTICIPANT_NAME_CLASS,
  QUEST_PARTICIPANT_SESSION_CLASS,
  QUEST_PARTICIPANT_ROLE_CLASS,
} from "./quest-participant-chip-style.js";
import { SessionHostBadge } from "./HostBadge.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { CodexQuestOwnerChip } from "./CodexQuestOwnerChip.js";
import { HoverCardSuppressionProvider } from "./hover-card-suppression-context.js";
import { QuestSessionActions } from "./QuestSessionActions.js";
import { descriptionExcerpt } from "./QuestDescriptionSummaryCard.js";

export interface QuestPreviewCardContentProps {
  quest: QuestmasterTask | QuestListPreview;
  eyebrowLabel?: string;
  title?: string;
  headingId?: string;
  headerAction?: ReactNode;
  suppressNestedHoverCards?: boolean;
  /** Called after Open Worker or Open Thread navigates, so the surrounding preview can close. */
  onSessionNavigate?: () => void;
}

export function QuestPreviewHeaderAction({
  label,
  ariaLabel,
  href,
  testId,
  previewFocusable = false,
  onActivate,
}: {
  label: string;
  ariaLabel: string;
  href?: string;
  testId?: string;
  previewFocusable?: boolean;
  onActivate: () => void;
}) {
  const className =
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-cc-border/70 bg-cc-hover/20 px-2 text-[11px] font-medium text-cc-muted transition-colors hover:border-cc-primary/45 hover:bg-cc-hover/55 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50 active:bg-cc-hover/70";
  const content = (
    <>
      <span>{label}</span>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
        <path d="M6 4h6v6" />
        <path d="M12 4 5 11" />
        <path d="M4 6v6h6" />
      </svg>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        data-testid={testId}
        data-preview-focusable={previewFocusable ? "true" : undefined}
        className={className}
        aria-label={ariaLabel}
        onClick={onActivate}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      data-preview-focusable={previewFocusable ? "true" : undefined}
      className={className}
      aria-label={ariaLabel}
      onClick={onActivate}
    >
      {content}
    </button>
  );
}

/** Canonical quest-preview presentation shared by legacy hover cards and feed eye details. */
export function QuestPreviewCardContent({
  quest,
  eyebrowLabel = quest.questId,
  title = quest.title,
  headingId,
  headerAction,
  suppressNestedHoverCards = false,
  onSessionNavigate,
}: QuestPreviewCardContentProps) {
  const isCancelled = isQuestCancelled(quest);
  const statusTheme = getQuestRecordStatusTheme(quest);
  const owner = getQuestDisplayOwner(quest);
  const ownerSessionId = getQuestOwnerSessionId(quest);
  const ownerSession = useStore((state) =>
    ownerSessionId ? state.sdkSessions.find((session) => session.sessionId === ownerSessionId) : undefined,
  );
  const ownerSessionName = ownerSession?.name;
  const ownerSessionNum = ownerSession?.sessionNum ?? null;
  const sessionBoards = useStore((state) => state.sessionBoards);
  const sessionCompletedBoards = useStore((state) => state.sessionCompletedBoards);
  const sessionBoardRowStatuses = useStore((state) => state.sessionBoardRowStatuses);
  const journeyContext = useMemo(
    () => findQuestJourneyContext(quest, sessionBoards, sessionCompletedBoards, sessionBoardRowStatuses),
    [quest, sessionBoards, sessionCompletedBoards, sessionBoardRowStatuses],
  );
  const journeyBoardRow = journeyContext?.row;
  const sdkSessions = useStore((state) => state.sdkSessions);
  const { workerSessionId, workerStatus, leaderSessionId } = useMemo(
    () => resolveQuestSessionTargets(quest, journeyContext, sdkSessions),
    [quest, journeyContext, sdkSessions],
  );
  const reviewerParticipant = journeyContext?.rowStatus?.reviewer ?? null;

  const isTerminalQuest = isCompletedJourneyPresentationStatus(quest.status);
  const journeyStatus = isTerminalQuest || journeyContext?.completed ? "done" : journeyBoardRow?.status;
  const canUseJourneyStatusLabel = !isTerminalQuest && !journeyContext?.completed;
  const journeyPhase = canUseJourneyStatusLabel ? getQuestJourneyPhaseForState(journeyBoardRow?.status) : null;
  const journeyPresentation = canUseJourneyStatusLabel ? getQuestJourneyPresentation(journeyBoardRow?.status) : null;
  const terminalStatusLabel = quest.status === "done" && !isCancelled ? "Completed" : statusTheme.label;
  const statusLabel = journeyPresentation?.label ?? journeyPhase?.label ?? terminalStatusLabel;
  const statusDotStyle = journeyPhase ? getQuestPhaseDotStyle(journeyPhase) : undefined;
  const queuedWaitForReason = formatQueuedWaitForReason(journeyBoardRow);
  // Open Worker and Open Thread already name the worker and leader; the owner gets its own chip only
  // when it is a Codex owner or a different session from the one Open Worker opens.
  const displayOwner = owner?.kind === "codex" || (owner && owner.sessionId !== workerSessionId) ? owner : null;
  const completedAt = quest.status === "done" ? quest.completedAt : null;
  const progressTldr = useMemo(() => {
    if ("phasePreviewLines" in quest && quest.phasePreviewLines?.length) {
      const latest = quest.phasePreviewLines.at(-1)!;
      return {
        kind: "phase" as const,
        label: "Latest Phase" as const,
        phaseLabel: latest.label,
        metaLabel: latest.metaLabel ?? "",
        text: latest.text,
      };
    }
    return selectQuestPreviewProgressTldr(quest as QuestmasterTask) ?? selectClosingText(quest);
  }, [quest]);
  // Quests without a TLDR still say what they are about, from the start of their description.
  const summary = useMemo(() => {
    const tldr = quest.tldr?.trim();
    if (tldr) return { label: "Summary", text: tldr };
    const excerpt = "description" in quest ? descriptionExcerpt(quest.description?.trim() ?? "") : "";
    return excerpt ? { label: "Description", text: excerpt } : null;
  }, [quest]);

  return (
    <HoverCardSuppressionProvider value={suppressNestedHoverCards}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div data-testid="quest-hover-status-row" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-xs text-cc-muted">{eyebrowLabel}</span>
            <span
              data-testid="quest-hover-status-chip"
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none ${statusTheme.bg} ${statusTheme.text} ${statusTheme.border}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDotStyle ? "" : statusTheme.dot}`}
                style={statusDotStyle}
              />
              {statusLabel}
            </span>
            {queuedWaitForReason && (
              <span data-testid="quest-hover-wait-for-reason" className="min-w-0 truncate text-xs text-cc-muted">
                {queuedWaitForReason}
              </span>
            )}
            {completedAt != null && (
              <span data-testid="quest-hover-completed-at" className="min-w-0 truncate text-xs text-cc-muted">
                {isCancelled ? "Cancelled" : "Finished"} {timeAgo(completedAt)}
              </span>
            )}
          </div>
          <h2
            id={headingId}
            data-testid="quest-hover-title"
            className="mt-1 text-[15px] font-semibold leading-snug text-cc-fg break-words"
          >
            {title}
          </h2>
        </div>
        {headerAction}
      </div>
      <QuestSessionActions
        className="mt-2.5"
        questId={quest.questId}
        workerSessionId={workerSessionId}
        workerStatus={workerStatus}
        leaderSessionId={leaderSessionId}
        onNavigate={onSessionNavigate}
      />
      {summary && (
        <QuestPreviewSection testId="quest-hover-tldr" label={summary.label}>
          <QuestPreviewMarkdown text={summary.text} />
        </QuestPreviewSection>
      )}
      {progressTldr && (
        <QuestPreviewSection
          testId="quest-hover-progress-tldr"
          label={progressTldr.label}
          detail={
            progressTldr.kind === "phase"
              ? `${progressTldr.phaseLabel}${progressTldr.metaLabel ? ` / ${progressTldr.metaLabel}` : ""}`
              : undefined
          }
        >
          <QuestPreviewMarkdown text={progressTldr.text} />
        </QuestPreviewSection>
      )}
      {journeyBoardRow?.journey && (
        <div data-testid="quest-hover-journey" className="mt-3 border-t border-cc-border/50 pt-3">
          <QuestJourneyPreviewCard journey={journeyBoardRow.journey} status={journeyStatus} />
        </div>
      )}
      <QuestHoverParticipants
        reviewerParticipant={reviewerParticipant}
        owner={displayOwner}
        ownerSessionNum={ownerSessionNum}
        ownerSessionName={ownerSessionName}
      />
    </HoverCardSuppressionProvider>
  );
}

function QuestPreviewSection({
  testId,
  label,
  detail,
  children,
}: {
  testId: string;
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="mt-3 border-t border-cc-border/50 pt-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-cc-muted">{label}</div>
        {detail && <div className="min-w-0 truncate text-[11px] text-cc-muted/80">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

// The summaries are what a reader opens the preview for, so they use body-size, full-contrast text.
function QuestPreviewMarkdown({ text }: { text: string }) {
  return (
    <MarkdownContent
      text={text}
      size="sm"
      variant="conservative"
      wrapLongContent
      questLinkSurface="legacy"
      className="mt-1 text-[13px] leading-relaxed text-cc-fg [&_li]:text-cc-fg [&_ol]:mb-1.5 [&_p:last-child]:mb-0 [&_p]:mb-1.5 [&_p]:text-cc-fg [&_ul]:mb-1.5"
    />
  );
}

/**
 * What a finished quest without a debrief TLDR can still show: the start of its debrief, or the
 * note it was closed or cancelled with. Cancelled quests have no debrief, only that note.
 */
function selectClosingText(quest: QuestmasterTask | QuestListPreview) {
  if (quest.status !== "done" || !("description" in quest)) return null;
  const cancelled = isQuestCancelled(quest);
  const debrief = cancelled ? "" : descriptionExcerpt(quest.debrief?.trim() ?? "");
  if (debrief) return { kind: "debrief" as const, label: "Final Debrief" as const, text: debrief };
  const note = quest.notes?.trim();
  if (!note) return null;
  return { kind: "note" as const, label: cancelled ? "Cancellation Note" : "Closing Note", text: note };
}

function formatQueuedWaitForReason(row: QuestJourneyBoardRow | undefined): string | null {
  if ((row?.status ?? "").trim().toUpperCase() !== "QUEUED") return null;
  const waitFor = row?.waitFor?.map((dep) => dep.trim()).filter(Boolean) ?? [];
  if (waitFor.length === 0) return null;
  return `Waiting for ${waitFor.map(formatWaitForRefLabel).join(", ")}`;
}

/** Sessions the top buttons do not already name: the reviewer, and an owner that is not the worker. */
function QuestHoverParticipants({
  reviewerParticipant,
  owner,
  ownerSessionNum,
  ownerSessionName,
}: {
  reviewerParticipant: BoardParticipantStatus | null;
  owner: QuestOwnerRef | null;
  ownerSessionNum: number | null;
  ownerSessionName?: string;
}) {
  if (!reviewerParticipant && !owner) return null;

  return (
    <div
      data-testid="quest-hover-participants"
      className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-cc-border/50 pt-3"
      aria-label="Other quest sessions"
    >
      {reviewerParticipant && (
        <QuestHoverParticipantSlot testId="quest-hover-reviewer-session">
          <QuestHoverSessionChip
            role="Reviewer"
            sessionId={reviewerParticipant.sessionId}
            sessionNum={reviewerParticipant.sessionNum}
            sessionName={reviewerParticipant.name}
            status={reviewerParticipant.status}
          />
        </QuestHoverParticipantSlot>
      )}
      {owner && (
        <QuestHoverParticipantSlot testId="quest-hover-owner-session">
          {owner.kind === "codex" ? (
            <CodexQuestOwnerChip owner={owner} />
          ) : (
            <QuestHoverSessionChip
              role="Owner session"
              sessionId={owner.sessionId}
              sessionNum={ownerSessionNum}
              sessionName={ownerSessionName}
            />
          )}
        </QuestHoverParticipantSlot>
      )}
    </div>
  );
}

function QuestHoverParticipantSlot({ testId, children }: { testId: string; children: ReactNode }) {
  return <span data-testid={testId}>{children}</span>;
}

function QuestHoverSessionChip({
  role,
  sessionId,
  sessionNum,
  sessionName,
  status,
}: {
  role: string;
  sessionId: string;
  sessionNum: number | null | undefined;
  sessionName?: string;
  status?: BoardParticipantStatus["status"];
}) {
  const dotProps = useParticipantSessionStatusDotProps(sessionId, status);
  const displaySession = sessionNum != null ? `#${sessionNum}` : sessionId.slice(0, 8);
  const titleSession = sessionNum != null ? `#${sessionNum}` : sessionId;
  const ariaLabel = [role, titleSession, sessionName].filter(Boolean).join(" ");

  return (
    <SessionInlineLink
      sessionId={sessionId}
      sessionNum={sessionNum}
      className={QUEST_PARTICIPANT_CHIP_CLASS}
      dataTestId="quest-hover-session-chip"
      ariaLabel={ariaLabel}
      title={`Open ${role.toLowerCase()} ${titleSession}`}
    >
      {dotProps && <SessionStatusDot className="mt-0" {...dotProps} />}
      <span className={QUEST_PARTICIPANT_ROLE_CLASS}>{role}</span>
      <span className={QUEST_PARTICIPANT_SESSION_CLASS}>{displaySession}</span>
      <SessionHostBadge sessionId={sessionId} />
      {sessionName && <span className={QUEST_PARTICIPANT_NAME_CLASS}>{sessionName}</span>}
    </SessionInlineLink>
  );
}
