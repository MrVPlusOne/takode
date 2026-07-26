import {
  getQuestDescription,
  getQuestDebrief,
  getQuestDebriefTldr,
  getQuestTldr,
} from "../utils/quest-editor-helpers.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestJourneyTimeline } from "./QuestJourneyTimeline.js";
import { QuestPhaseDocumentationTimeline } from "./QuestPhaseDocumentationTimeline.js";
import { QuestTextImagePreviews } from "./QuestPhaseNoteImages.js";
import { QuestRelationshipLinks } from "./QuestRelationshipLinks.js";
import { useState, type ReactNode } from "react";
import type { QuestmasterTask } from "../types.js";
import type { QuestPhaseDocumentationSummary } from "../../shared/quest-phase-documentation-summary.js";
import type { QuestJourneyPlanState } from "../../shared/quest-journey.js";

interface QuestDetailTextSectionsProps {
  quest: QuestmasterTask;
  phaseDocumentationSummary: QuestPhaseDocumentationSummary;
  journey?: QuestJourneyPlanState;
  journeyStatus?: string | null;
  searchHighlight?: string | null;
  sessionId?: string;
  onSessionNavigate?: () => void;
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
  beforeSummary,
}: QuestDetailTextSectionsProps) {
  const description = getQuestDescription(quest);
  const questTldr = getQuestTldr(quest);
  const questDebrief = getQuestDebrief(quest);
  const questDebriefTldr = getQuestDebriefTldr(quest);
  const hasFinalDebrief = Boolean(questDebrief);
  const [journeyDetailsExpanded, setJourneyDetailsExpanded] = useState(true);
  const detailSearchHighlight = searchHighlight
    ? { query: searchHighlight, mode: "fuzzy" as const, isCurrent: false }
    : null;

  if (
    !questTldr &&
    !description &&
    !questDebrief &&
    !questDebriefTldr &&
    !quest.relatedQuests?.length &&
    !beforeSummary &&
    !phaseDocumentationSummary.hasPhaseDocumentation &&
    !(quest.status === "done" && journey)
  ) {
    return null;
  }

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-x-hidden">
      <QuestRelationshipLinks quest={quest} />
      {beforeSummary}
      {hasFinalDebrief ? (
        <>
          {(questTldr || questDebriefTldr) && (
            <div className="min-w-0 max-w-full space-y-2">
              <QuestDetailSectionLabel>TLDR</QuestDetailSectionLabel>
              {questTldr && (
                <QuestDetailTldrCard label="Description TLDR">
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
            <QuestDetailSectionLabel>Full Final Debrief</QuestDetailSectionLabel>
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
              <QuestDetailSectionLabel>Final Debrief</QuestDetailSectionLabel>
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
            summary={phaseDocumentationSummary}
            searchHighlight={searchHighlight}
            sessionId={sessionId}
            onSessionNavigate={onSessionNavigate}
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
