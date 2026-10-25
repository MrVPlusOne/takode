import {
  getQuestDescription,
  getQuestDebrief,
  getQuestDebriefTldr,
  getQuestTldr,
} from "../utils/quest-editor-helpers.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestJourneyTimeline } from "./QuestJourneyTimeline.js";
import { QuestPhaseDocumentationTimeline, type JourneyFeedbackRenderer } from "./QuestPhaseDocumentationTimeline.js";
import { QuestTextImagePreviews } from "./QuestPhaseNoteImages.js";
import { QuestMachineStamp } from "./QuestMachineStamp.js";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { buildQuestRounds } from "../../shared/quest-rounds.js";
import type { QuestmasterTask } from "../types.js";
import type { QuestPhaseDocumentationSummary } from "../../shared/quest-phase-documentation-summary.js";
import type { QuestJourneyPlanState } from "../../shared/quest-journey.js";
import type { QuestFeedbackTargetRequest, QuestRoundTargetRequest } from "../utils/quest-link-target.js";

interface QuestDetailTextSectionsProps {
  quest: QuestmasterTask;
  phaseDocumentationSummary: QuestPhaseDocumentationSummary;
  journey?: QuestJourneyPlanState;
  journeyStatus?: string | null;
  searchHighlight?: string | null;
  sessionId?: string;
  onSessionNavigate?: () => void;
  feedbackTarget?: QuestFeedbackTargetRequest | null;
  /** Round a round link opened the quest at. */
  roundTarget?: QuestRoundTargetRequest | null;
  highlightedFeedbackIndex?: number | null;
  onFeedbackTargetReady?: (element: HTMLElement | null) => void;
  /** Renders an expanded unscoped feedback entry shown inside the Journey timeline. */
  renderFeedbackEntry?: JourneyFeedbackRenderer;
  beforeSummary?: ReactNode;
}

export function QuestDetailTextSections({
  quest,
  phaseDocumentationSummary,
  journey,
  journeyStatus,
  searchHighlight,
  sessionId,
  onSessionNavigate,
  feedbackTarget,
  roundTarget,
  highlightedFeedbackIndex,
  onFeedbackTargetReady,
  renderFeedbackEntry,
  beforeSummary,
}: QuestDetailTextSectionsProps) {
  const description = getQuestDescription(quest);
  const questTldr = getQuestTldr(quest);
  const questDebrief = getQuestDebrief(quest);
  const questDebriefTldr = getQuestDebriefTldr(quest);
  const hasFinalDebrief = Boolean(questDebrief);
  const [journeyDetailsExpanded, setJourneyDetailsExpanded] = useState(true);
  // With phase documentation, the timeline shows every feedback entry, scoped or not.
  const targetInTimeline = Boolean((feedbackTarget || roundTarget) && phaseDocumentationSummary.hasPhaseDocumentation);
  const rounds = useMemo(() => buildQuestRounds(quest), [quest]);
  // A reopened quest's open round says what the current Work is for, beside the standing description.
  const latestRound = rounds.rounds.at(-1);
  const openRound = rounds.rounds.length > 1 && latestRound?.open ? latestRound : undefined;
  useEffect(() => setJourneyDetailsExpanded(true), [quest.questId]);
  useEffect(() => {
    if (targetInTimeline) setJourneyDetailsExpanded(true);
  }, [feedbackTarget?.requestId, roundTarget?.requestId, targetInTimeline]);
  const detailSearchHighlight = searchHighlight
    ? { query: searchHighlight, mode: "fuzzy" as const, isCurrent: false }
    : null;

  if (
    !questTldr &&
    !description &&
    !questDebrief &&
    !questDebriefTldr &&
    !beforeSummary &&
    !phaseDocumentationSummary.hasPhaseDocumentation &&
    !(quest.status === "done" && journey)
  ) {
    return null;
  }

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-x-hidden">
      {beforeSummary}
      {hasFinalDebrief ? (
        <>
          {(questTldr || questDebriefTldr) && (
            <div className="min-w-0 max-w-full space-y-2">
              {questTldr && (
                <QuestDetailTldrCard label="TLDR">
                  <MarkdownContent
                    text={questTldr}
                    size="sm"
                    sessionId={sessionId}
                    searchHighlight={detailSearchHighlight}
                    wrapLongContent
                    onSessionNavigate={onSessionNavigate}
                  />
                </QuestDetailTldrCard>
              )}
              {questDebriefTldr && (
                <QuestDetailTldrCard label="Debrief TLDR">
                  <MarkdownContent
                    text={questDebriefTldr}
                    size="sm"
                    sessionId={sessionId}
                    searchHighlight={detailSearchHighlight}
                    wrapLongContent
                    onSessionNavigate={onSessionNavigate}
                  />
                </QuestDetailTldrCard>
              )}
            </div>
          )}
          {description && (
            <div className="min-w-0 max-w-full space-y-2">
              <QuestDetailSectionLabel>Full Description</QuestDetailSectionLabel>
              <MarkdownContent
                text={description}
                size="sm"
                sessionId={sessionId}
                searchHighlight={detailSearchHighlight}
                wrapLongContent
                onSessionNavigate={onSessionNavigate}
              />
              <QuestTextImagePreviews
                text={description}
                sessionId={sessionId}
                testId="quest-description-image-thumbnails"
              />
            </div>
          )}
          <div className="min-w-0 max-w-full space-y-2">
            <div className="flex items-baseline gap-1.5">
              <QuestDetailSectionLabel>Full Debrief</QuestDetailSectionLabel>
              <QuestMachineStamp machine={quest.status === "done" ? quest.debriefMachine : undefined} />
            </div>
            <MarkdownContent
              text={questDebrief ?? ""}
              size="sm"
              sessionId={sessionId}
              searchHighlight={detailSearchHighlight}
              wrapLongContent
              onSessionNavigate={onSessionNavigate}
            />
            <QuestTextImagePreviews
              text={questDebrief ?? ""}
              sessionId={sessionId}
              testId="quest-debrief-image-thumbnails"
            />
          </div>
        </>
      ) : (
        <>
          {openRound && (
            <div className="min-w-0 max-w-full space-y-2" data-testid="quest-detail-open-round">
              <QuestDetailSectionLabel>Current round</QuestDetailSectionLabel>
              <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-cc-border bg-cc-input-bg px-3 py-2">
                <div className="mb-1 text-xs font-semibold text-cc-fg">
                  Round {openRound.number}: {openRound.title}
                </div>
                <MarkdownContent
                  text={openRound.brief ?? "No brief for this round."}
                  size="sm"
                  sessionId={sessionId}
                  searchHighlight={detailSearchHighlight}
                  wrapLongContent
                  onSessionNavigate={onSessionNavigate}
                />
              </div>
            </div>
          )}
          {(questTldr || description) && (
            <div className="min-w-0 max-w-full space-y-2">
              <QuestDetailSectionLabel>Description</QuestDetailSectionLabel>
              {questTldr && (
                <QuestDetailTldrCard label="TLDR">
                  <MarkdownContent
                    text={questTldr}
                    size="sm"
                    sessionId={sessionId}
                    searchHighlight={detailSearchHighlight}
                    wrapLongContent
                    onSessionNavigate={onSessionNavigate}
                  />
                </QuestDetailTldrCard>
              )}
              {description && (
                <MarkdownContent
                  text={description}
                  size="sm"
                  sessionId={sessionId}
                  searchHighlight={detailSearchHighlight}
                  wrapLongContent
                  onSessionNavigate={onSessionNavigate}
                />
              )}
            </div>
          )}
          {questDebriefTldr && (
            <div className="min-w-0 max-w-full space-y-2">
              <QuestDetailSectionLabel>Debrief</QuestDetailSectionLabel>
              <QuestDetailTldrCard label="TLDR">
                <MarkdownContent
                  text={questDebriefTldr}
                  size="sm"
                  sessionId={sessionId}
                  searchHighlight={detailSearchHighlight}
                  wrapLongContent
                  onSessionNavigate={onSessionNavigate}
                />
              </QuestDetailTldrCard>
            </div>
          )}
        </>
      )}
      {phaseDocumentationSummary.hasPhaseDocumentation && (
        <QuestDetailToggleSection
          title="Journey Details"
          expanded={journeyDetailsExpanded}
          onToggle={() => setJourneyDetailsExpanded((expanded) => !expanded)}
        >
          <QuestPhaseDocumentationTimeline
            key={quest.questId}
            summary={phaseDocumentationSummary}
            searchHighlight={searchHighlight}
            sessionId={sessionId}
            onSessionNavigate={onSessionNavigate}
            feedbackTarget={feedbackTarget}
            rounds={rounds}
            roundTarget={roundTarget}
            highlightedFeedbackIndex={highlightedFeedbackIndex}
            onFeedbackTargetReady={onFeedbackTargetReady}
            renderFeedbackEntry={renderFeedbackEntry}
          />
        </QuestDetailToggleSection>
      )}
      {quest.status === "done" && !phaseDocumentationSummary.hasPhaseDocumentation && journey && (
        <QuestDetailToggleSection
          title="Journey Details"
          expanded={journeyDetailsExpanded}
          onToggle={() => setJourneyDetailsExpanded((expanded) => !expanded)}
          testId="quest-detail-journey-section"
        >
          <QuestJourneyTimeline journey={journey} status={journeyStatus} variant="vertical" />
        </QuestDetailToggleSection>
      )}
    </div>
  );
}

function QuestDetailSectionLabel({ children }: { children: string }) {
  return <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/60">{children}</div>;
}

function QuestDetailToggleSection({
  title,
  expanded,
  onToggle,
  testId,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-x-hidden" data-testid={testId}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center justify-between gap-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/60 transition-colors hover:text-cc-muted"
        aria-expanded={expanded}
        onClick={onToggle}
        data-testid="quest-journey-details-toggle"
      >
        <span>{title}</span>
        <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true">
          ▸
        </span>
      </button>
      {expanded && children}
    </div>
  );
}

function QuestDetailTldrCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-cc-border bg-cc-input-bg px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/60">{label}</div>
      {children}
    </div>
  );
}
