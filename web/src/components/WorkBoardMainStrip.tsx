/**
 * The board summary in the Main thread strip: quests in each phase, completed quests and
 * other threads, each opening its board view. It stays on one quiet row on a phone.
 */
import type { ReactNode } from "react";
import type { LeaderActivePhaseSummarySegment } from "../../shared/leader-active-phase-summary.js";
import type { LeaderWorkboardView } from "../store-types.js";
import { getQuestPhaseColorValue } from "../utils/quest-phase-theme.js";

export function MainStripSummary({
  summary,
  completedCount,
  otherThreadCount,
  activeView,
  onSelectView,
}: {
  summary: readonly LeaderActivePhaseSummarySegment[];
  completedCount: number;
  otherThreadCount: number;
  activeView: LeaderWorkboardView | null;
  onSelectView: (view: LeaderWorkboardView) => void;
}) {
  const phaseNames = summary.map((segment) => `${segment.count} ${segment.label}`).join(", ");
  return (
    <span className="flex min-w-0 flex-1 items-center gap-0.5" data-testid="workboard-main-summary">
      {summary.length > 0 && (
        <SummaryItem
          view="active"
          activeView={activeView}
          onSelectView={onSelectView}
          label={`Open active workboard: ${phaseNames}`}
          testId="workboard-active-button"
          grow
        >
          <PhaseWords summary={summary} />
        </SummaryItem>
      )}
      {completedCount > 0 && (
        <SummaryItem
          view="completed"
          activeView={activeView}
          onSelectView={onSelectView}
          label={`Open completed quests: ${completedCount}`}
          testId="workboard-completed-button"
        >
          <span className="tabular-nums">{completedCount} done</span>
        </SummaryItem>
      )}
      {otherThreadCount > 0 && (
        <SummaryItem
          view="other"
          activeView={activeView}
          onSelectView={onSelectView}
          label={`Open other threads: ${otherThreadCount}`}
          testId="workboard-other-button"
        >
          <span className="tabular-nums">{otherThreadCount} other</span>
        </SummaryItem>
      )}
      {summary.length === 0 && completedCount === 0 && otherThreadCount === 0 && (
        <span className="min-w-0 truncate px-1.5 text-[12px] text-cc-muted" data-testid="workboard-empty-summary">
          Empty
        </span>
      )}
    </span>
  );
}

/** A plain text control: no border or fill until it is pressed or its view is open. */
function SummaryItem({
  view,
  activeView,
  onSelectView,
  label,
  testId,
  grow = false,
  children,
}: {
  view: LeaderWorkboardView;
  activeView: LeaderWorkboardView | null;
  onSelectView: (view: LeaderWorkboardView) => void;
  label: string;
  testId: string;
  grow?: boolean;
  children: ReactNode;
}) {
  const selected = activeView === view;
  return (
    <button
      type="button"
      onClick={() => onSelectView(view)}
      className={`inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 ${
        grow ? "shrink" : "shrink-0"
      } ${selected ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:bg-cc-hover/60 hover:text-cc-fg"}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** Phase names in their phase colors, as plain text that truncates rather than wrapping. */
function PhaseWords({ summary }: { summary: readonly LeaderActivePhaseSummarySegment[] }) {
  return (
    <span className="min-w-0 truncate" data-testid="workboard-phase-summary">
      {summary.map((segment, index) => (
        <span key={segment.label}>
          {index > 0 && <span className="text-cc-muted"> · </span>}
          <span
            style={
              segment.color && segment.colorName
                ? { color: getQuestPhaseColorValue({ name: segment.colorName, accent: segment.color }) }
                : undefined
            }
          >
            {segment.count} {segment.label}
          </span>
        </span>
      ))}
    </span>
  );
}
