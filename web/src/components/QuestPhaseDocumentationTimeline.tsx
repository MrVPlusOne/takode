import { useState } from "react";
import { formatQuestJourneyDuration, getQuestJourneyPhase } from "../../shared/quest-journey.js";
import {
  phaseDocumentationPreview,
  type QuestPhaseDocumentationSummary,
} from "../../shared/quest-phase-documentation-summary.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { getQuestPhaseBorderStyle, getQuestPhaseColorValue } from "../utils/quest-phase-theme.js";
import { CompactSessionLink } from "./CompactSessionLink.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestPhaseNoteImages } from "./QuestPhaseNoteImages.js";

interface QuestPhaseDocumentationTimelineProps {
  summary: QuestPhaseDocumentationSummary;
  searchHighlight?: string | null;
  sessionId?: string;
  onSessionNavigate?: () => void;
}

type PhaseDocumentationGroup = QuestPhaseDocumentationSummary["groups"][number];
type OmittedPhaseDirection = "earlier" | "later";

type DocumentationRunDisplayItem =
  | { kind: "group"; group: PhaseDocumentationGroup }
  | { kind: "omitted"; direction: OmittedPhaseDirection; count: number; expanded: boolean };

interface DocumentationRunGroup {
  key: string;
  label: string;
  metaLabel: string;
  defaultExpanded: boolean;
  groups: PhaseDocumentationGroup[];
}

const PHASE_DOCUMENTATION_GROUPS_BEFORE = 5;
const PHASE_DOCUMENTATION_GROUPS_AFTER = 10;
const PHASE_DOCUMENTATION_VISIBLE_LIMIT = PHASE_DOCUMENTATION_GROUPS_BEFORE + PHASE_DOCUMENTATION_GROUPS_AFTER + 1;

export function QuestPhaseDocumentationTimeline({
  summary,
  searchHighlight,
  sessionId,
  onSessionNavigate,
}: QuestPhaseDocumentationTimelineProps) {
  const groups = summary.groups.filter((group) => group.entries.length > 0 || group.phaseStatus !== "pending");
  const runGroups = buildDocumentationRunGroups(summary, groups);
  const renderRunSections = runGroups.length > 1;
  const hasSearchHighlight = Boolean(searchHighlight?.trim());
  const [runExpansionOverrides, setRunExpansionOverrides] = useState<Record<string, boolean>>({});
  const [windowExpansionOverrides, setWindowExpansionOverrides] = useState<Record<string, boolean>>({});
  if (groups.length === 0) return null;
  const now = Date.now();

  function runExpanded(run: DocumentationRunGroup): boolean {
    if (hasSearchHighlight) return true;
    return runExpansionOverrides[run.key] ?? run.defaultExpanded;
  }

  function toggleRun(run: DocumentationRunGroup) {
    const expanded = runExpanded(run);
    setRunExpansionOverrides((current) => ({ ...current, [run.key]: !expanded }));
  }

  function windowExpanded(runKey: string, direction: OmittedPhaseDirection): boolean {
    if (hasSearchHighlight) return true;
    return windowExpansionOverrides[windowExpansionKey(runKey, direction)] === true;
  }

  function toggleWindow(runKey: string, direction: OmittedPhaseDirection) {
    const key = windowExpansionKey(runKey, direction);
    setWindowExpansionOverrides((current) => ({ ...current, [key]: current[key] !== true }));
  }

  return (
    <section
      className="min-w-0 max-w-full overflow-hidden rounded-md border border-cc-border bg-cc-hover/20 p-2"
      data-testid="quest-phase-documentation-timeline"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/70">
            Phase Documentation
          </div>
        </div>
        <div className="shrink-0 text-[10px] text-cc-muted">
          {groups.length} phase{groups.length === 1 ? "" : "s"}
        </div>
      </div>
      {renderRunSections ? (
        <div className="min-w-0 max-w-full space-y-2" data-testid="quest-phase-documentation-run-list">
          {runGroups.map((run) => {
            const expanded = runExpanded(run);
            return (
              <div
                key={run.key}
                className="min-w-0 max-w-full overflow-hidden rounded-md border border-cc-border/70 bg-cc-input-bg/35"
                data-testid="quest-phase-documentation-run"
                data-run-key={run.key}
                data-run-expanded={expanded ? "true" : "false"}
              >
                <button
                  type="button"
                  onClick={() => toggleRun(run)}
                  aria-expanded={expanded}
                  className="flex w-full min-w-0 items-center justify-between gap-3 px-2 py-1.5 text-left transition-colors hover:bg-cc-hover/60"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`h-3 w-3 shrink-0 text-cc-muted/60 transition-transform ${expanded ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      ▸
                    </span>
                    <span className="min-w-0 truncate text-[11px] font-semibold text-cc-fg">{run.label}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-cc-muted">{run.metaLabel}</span>
                </button>
                {expanded && (
                  <div className="border-t border-cc-border/60 px-2 py-1.5">
                    <PhaseDocumentationGroupList
                      groups={run.groups}
                      runKey={run.key}
                      now={now}
                      searchHighlight={searchHighlight}
                      sessionId={sessionId}
                      onSessionNavigate={onSessionNavigate}
                      isWindowExpanded={(direction) => windowExpanded(run.key, direction)}
                      onToggleWindow={(direction) => toggleWindow(run.key, direction)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <PhaseDocumentationGroupList
          groups={runGroups[0]?.groups ?? groups}
          runKey={runGroups[0]?.key ?? "all"}
          now={now}
          searchHighlight={searchHighlight}
          sessionId={sessionId}
          onSessionNavigate={onSessionNavigate}
          isWindowExpanded={(direction) => windowExpanded(runGroups[0]?.key ?? "all", direction)}
          onToggleWindow={(direction) => toggleWindow(runGroups[0]?.key ?? "all", direction)}
        />
      )}
    </section>
  );
}

function PhaseDocumentationGroupList({
  groups,
  runKey,
  now,
  searchHighlight,
  sessionId,
  onSessionNavigate,
  isWindowExpanded,
  onToggleWindow,
}: {
  groups: PhaseDocumentationGroup[];
  runKey: string;
  now: number;
  searchHighlight?: string | null;
  sessionId?: string;
  onSessionNavigate?: () => void;
  isWindowExpanded: (direction: OmittedPhaseDirection) => boolean;
  onToggleWindow: (direction: OmittedPhaseDirection) => void;
}) {
  const hasSearchHighlight = Boolean(searchHighlight?.trim());
  const { earlierGroups, visibleGroups, laterGroups } = hasSearchHighlight
    ? { earlierGroups: [], visibleGroups: groups, laterGroups: [] }
    : getDocumentationGroupWindow(groups);
  const showEarlier = isWindowExpanded("earlier");
  const showLater = isWindowExpanded("later");
  const displayItems = getDocumentationDisplayItems({
    earlierGroups,
    visibleGroups,
    laterGroups,
    showEarlier,
    showLater,
  });

  return (
    <ol className="min-w-0 max-w-full space-y-0" data-testid="quest-phase-documentation-group-list">
      {displayItems.map((displayItem, itemIndex) => {
        const hasNext = itemIndex < displayItems.length - 1;
        if (displayItem.kind === "omitted") {
          const isEarlier = displayItem.direction === "earlier";
          const expanded = displayItem.expanded;
          const label = `${expanded ? "Hide" : "Show"} ${displayItem.count} ${isEarlier ? "earlier" : "later"} phase${displayItem.count === 1 ? "" : "s"}`;
          return (
            <li
              key={`${runKey}-omitted-${displayItem.direction}`}
              className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-x-2"
              data-testid="quest-phase-documentation-omitted-phases"
              data-omitted-direction={displayItem.direction}
              data-omitted-count={displayItem.count}
            >
              <div className="flex flex-col items-center">
                <span className="mt-1 h-1.5 w-1.5 rounded-full border border-cc-muted/35 bg-cc-muted/15" />
                {hasNext && <span className="mt-0.5 w-px flex-1 bg-cc-muted/20" aria-hidden="true" />}
              </div>
              <div className={hasNext ? "min-w-0 pb-1.5" : "min-w-0 pb-0"}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => onToggleWindow(displayItem.direction)}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-dashed border-cc-border/70 bg-cc-hover/20 px-2 py-0.5 text-[10px] text-cc-muted transition-colors hover:border-cc-muted/50 hover:bg-cc-hover hover:text-cc-fg"
                >
                  <span className="truncate">{label}</span>
                </button>
              </div>
            </li>
          );
        }

        return (
          <PhaseDocumentationGroupRow
            key={displayItem.group.key}
            group={displayItem.group}
            groupIndex={itemIndex}
            hasNext={hasNext}
            now={now}
            searchHighlight={searchHighlight}
            sessionId={sessionId}
            onSessionNavigate={onSessionNavigate}
          />
        );
      })}
    </ol>
  );
}

function PhaseDocumentationGroupRow({
  group,
  groupIndex,
  hasNext,
  now,
  searchHighlight,
  sessionId,
  onSessionNavigate,
}: {
  group: PhaseDocumentationGroup;
  groupIndex: number;
  hasNext: boolean;
  now: number;
  searchHighlight?: string | null;
  sessionId?: string;
  onSessionNavigate?: () => void;
}) {
  const phase = group.phaseId ? getQuestJourneyPhase(group.phaseId) : null;
  const durationLabel = phaseDocumentationDurationLabel(group, now);
  return (
    <li
      className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-x-2"
      data-testid="quest-phase-documentation-group"
      data-phase-id={group.phaseId ?? ""}
      data-phase-position={group.phasePosition ?? ""}
      data-scope-matched={group.scopeMatched ? "true" : "false"}
    >
      <div className="flex flex-col items-center">
        <span
          className="mt-1 h-2.5 w-2.5 rounded-full border"
          style={
            phase
              ? {
                  ...getQuestPhaseBorderStyle(phase),
                  backgroundColor: getQuestPhaseColorValue(phase.color, 0.13),
                }
              : undefined
          }
          aria-hidden="true"
        />
        {hasNext && <span className="mt-0.5 w-px flex-1 bg-cc-muted/25" aria-hidden="true" />}
      </div>
      <div className={hasNext ? "min-w-0 pb-2" : "min-w-0 pb-0"}>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="w-4 shrink-0 text-right text-[10px] text-cc-muted">
            {group.phasePosition ?? groupIndex + 1}
          </span>
          <span className="min-w-0 truncate text-xs font-semibold text-cc-fg">{group.displayLabel}</span>
          {group.metaLabel && <span className="shrink-0 text-[10px] text-cc-muted">{group.metaLabel}</span>}
          {durationLabel && (
            <span className="shrink-0 text-[10px] text-cc-muted" data-testid="quest-phase-documentation-duration">
              {durationLabel}
            </span>
          )}
        </div>
        {group.entries.length > 0 && (
          <div className="ml-[1.375rem] mt-1 min-w-0 max-w-full space-y-1.5 overflow-hidden">
            {group.entries.map((entry) => {
              const preview = entry.tldr?.trim() || compactText(phaseDocumentationPreview(entry));
              return (
                <PhaseDocumentationEntry
                  key={entry.index}
                  entry={entry}
                  preview={preview}
                  searchHighlight={searchHighlight}
                  sessionId={sessionId}
                  onSessionNavigate={onSessionNavigate}
                />
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

function phaseDocumentationDurationLabel(
  group: QuestPhaseDocumentationSummary["groups"][number],
  now: number,
): string | null {
  if (!group.startedAt) {
    return group.phaseStatus === "active" || group.phaseStatus === "completed" ? "duration unavailable" : null;
  }
  if (group.completedAt && group.completedAt >= group.startedAt) {
    return formatQuestJourneyDuration(group.completedAt - group.startedAt);
  }
  if (group.phaseStatus === "active") {
    return formatQuestJourneyDuration(now - group.startedAt);
  }
  if (group.phaseStatus === "completed") return "duration unavailable";
  return null;
}

function PhaseDocumentationEntry({
  entry,
  preview,
  searchHighlight,
  sessionId,
  onSessionNavigate,
}: {
  entry: QuestPhaseDocumentationSummary["groups"][number]["entries"][number];
  preview: string;
  searchHighlight?: string | null;
  sessionId?: string;
  onSessionNavigate?: () => void;
}) {
  const highlight = searchHighlight ? { query: searchHighlight, mode: "fuzzy" as const, isCurrent: false } : null;

  return (
    <div
      className="min-w-0 max-w-full overflow-hidden rounded-md border border-cc-border/70 bg-cc-input-bg/70 px-2 py-1.5"
      data-testid="quest-phase-documentation-entry"
    >
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="shrink-0 font-mono-code text-[10px] text-cc-muted">#{entry.index}</span>
        {entry.authorSessionId ? (
          <CompactSessionLink
            sessionId={entry.authorSessionId}
            className="text-[10px] font-medium font-mono text-cc-primary hover:text-cc-primary-hover"
            onNavigate={onSessionNavigate}
          />
        ) : (
          <span className="text-[10px] font-medium text-cc-muted">{entry.author}</span>
        )}
        {entry.kind && <span className="text-[10px] text-cc-muted">{entry.kind}</span>}
        <span className="text-[10px] text-cc-muted/60">{timeAgo(entry.ts)}</span>
      </div>
      <div className="min-w-0 max-w-full overflow-hidden text-xs text-cc-fg">
        <MarkdownContent
          text={preview}
          size="sm"
          sessionId={sessionId}
          searchHighlight={highlight}
          wrapLongContent
          onSessionNavigate={onSessionNavigate}
        />
      </div>
      <QuestPhaseNoteImages text={entry.text} sessionId={sessionId} />
      <details className="mt-1 min-w-0 max-w-full overflow-hidden text-xs text-cc-muted">
        <summary className="cursor-pointer select-none">Full phase detail</summary>
        <div className="mt-1 min-w-0 max-w-full overflow-hidden text-cc-fg">
          <MarkdownContent
            text={entry.text}
            size="sm"
            sessionId={sessionId}
            searchHighlight={highlight}
            wrapLongContent
            onSessionNavigate={onSessionNavigate}
          />
        </div>
      </details>
    </div>
  );
}

function compactText(text: string, max = 180): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3).trimEnd()}...`;
}

function buildDocumentationRunGroups(
  summary: QuestPhaseDocumentationSummary,
  groups: PhaseDocumentationGroup[],
): DocumentationRunGroup[] {
  const primaryRunId = summary.primaryRun?.runId;
  const runCount = new Set(groups.flatMap((group) => (group.journeyRunId ? [group.journeyRunId] : []))).size;
  const grouped = new Map<string, PhaseDocumentationGroup[]>();
  for (const group of groups) {
    const key = group.journeyRunId ? `run:${group.journeyRunId}` : "unmatched";
    const existing = grouped.get(key);
    if (existing) existing.push(group);
    else grouped.set(key, [group]);
  }

  return [...grouped.entries()].map(([key, runGroups]) => {
    const firstGroup = runGroups[0];
    const isPrimaryRun = Boolean(firstGroup?.journeyRunId && firstGroup.journeyRunId === primaryRunId);
    const isUnmatched = key === "unmatched";
    const entryCount = runGroups.reduce((count, group) => count + group.entries.length, 0);
    const label = isUnmatched
      ? "Other phase notes"
      : isPrimaryRun
        ? "Latest Journey run"
        : `Earlier Journey run${firstGroup?.journeyRunOrdinal ? ` ${firstGroup.journeyRunOrdinal}` : ""}`;
    const metaLabel = [
      `${runGroups.length} phase${runGroups.length === 1 ? "" : "s"}`,
      `${entryCount} note${entryCount === 1 ? "" : "s"}`,
    ].join(" · ");
    return {
      key,
      label: runCount > 1 || isUnmatched ? label : "Journey run",
      metaLabel,
      defaultExpanded: isPrimaryRun || (!isUnmatched && runCount <= 1) || (isUnmatched && runCount === 0),
      groups: runGroups,
    };
  });
}

function getDocumentationGroupWindow(groups: PhaseDocumentationGroup[]): {
  earlierGroups: PhaseDocumentationGroup[];
  visibleGroups: PhaseDocumentationGroup[];
  laterGroups: PhaseDocumentationGroup[];
} {
  if (groups.length <= PHASE_DOCUMENTATION_VISIBLE_LIMIT) {
    return { earlierGroups: [], visibleGroups: groups, laterGroups: [] };
  }

  const anchorIndex = getDocumentationAnchorIndex(groups);
  const startIndex = Math.max(0, anchorIndex - PHASE_DOCUMENTATION_GROUPS_BEFORE);
  const endIndex = Math.min(groups.length - 1, anchorIndex + PHASE_DOCUMENTATION_GROUPS_AFTER);
  return {
    earlierGroups: groups.slice(0, startIndex),
    visibleGroups: groups.slice(startIndex, endIndex + 1),
    laterGroups: groups.slice(endIndex + 1),
  };
}

function getDocumentationAnchorIndex(groups: PhaseDocumentationGroup[]): number {
  const activeIndex = groups.findIndex((group) => group.phaseStatus === "active");
  return activeIndex >= 0 ? activeIndex : Math.max(0, groups.length - 1);
}

function getDocumentationDisplayItems({
  earlierGroups,
  visibleGroups,
  laterGroups,
  showEarlier,
  showLater,
}: {
  earlierGroups: PhaseDocumentationGroup[];
  visibleGroups: PhaseDocumentationGroup[];
  laterGroups: PhaseDocumentationGroup[];
  showEarlier: boolean;
  showLater: boolean;
}): DocumentationRunDisplayItem[] {
  return [
    ...(showEarlier ? earlierGroups.map((group) => ({ kind: "group" as const, group })) : []),
    ...(earlierGroups.length > 0
      ? [
          {
            kind: "omitted" as const,
            direction: "earlier" as const,
            count: earlierGroups.length,
            expanded: showEarlier,
          },
        ]
      : []),
    ...visibleGroups.map((group) => ({ kind: "group" as const, group })),
    ...(laterGroups.length > 0
      ? [{ kind: "omitted" as const, direction: "later" as const, count: laterGroups.length, expanded: showLater }]
      : []),
    ...(showLater ? laterGroups.map((group) => ({ kind: "group" as const, group })) : []),
  ];
}

function windowExpansionKey(runKey: string, direction: OmittedPhaseDirection): string {
  return `${runKey}:${direction}`;
}
