import type {
  IndexedQuestFeedbackEntry,
  QuestPhaseDocumentationGroup,
} from "../../shared/quest-phase-documentation-summary.js";

export interface UnscopedFeedbackPlacement {
  /** Feedback shown inside a phase, keyed by phase documentation group key, in time order. */
  byGroupKey: Map<string, IndexedQuestFeedbackEntry[]>;
  /** Feedback that falls outside every Journey run (before, between or after runs), in time order. */
  outside: IndexedQuestFeedbackEntry[];
}

/**
 * Places feedback that has no phase scope at the point of the Journey its timestamp falls in.
 *
 * A run spans from its first phase start to its last recorded activity: a phase start or
 * completion, or a phase note. Only the latest run stays open while its last phase is active;
 * older runs often still claim to be active, so their status is not trusted. This keeps notes
 * written between runs, such as the request that started the next run, outside both runs.
 * Inside a run, feedback belongs to the latest phase that started at or before it.
 */
export function placeUnscopedFeedback(
  groups: QuestPhaseDocumentationGroup[],
  feedback: IndexedQuestFeedbackEntry[],
): UnscopedFeedbackPlacement {
  const spans = journeyRunSpans(groups);
  const byGroupKey = new Map<string, IndexedQuestFeedbackEntry[]>();
  const outside: IndexedQuestFeedbackEntry[] = [];
  for (const entry of [...feedback].sort(compareFeedbackTime)) {
    const span = spans.find((candidate) => entry.ts >= candidate.start && entry.ts <= candidate.end);
    const phase = span?.phases.findLast((group) => (group.startedAt ?? 0) <= entry.ts);
    if (!phase) {
      outside.push(entry);
      continue;
    }
    const placed = byGroupKey.get(phase.key);
    if (placed) placed.push(entry);
    else byGroupKey.set(phase.key, [entry]);
  }
  return { byGroupKey, outside };
}

export function compareFeedbackTime(a: IndexedQuestFeedbackEntry, b: IndexedQuestFeedbackEntry): number {
  return a.ts - b.ts || a.index - b.index;
}

interface JourneyRunSpan {
  start: number;
  end: number;
  /** Started phases of the run, by start time. */
  phases: QuestPhaseDocumentationGroup[];
}

function journeyRunSpans(groups: QuestPhaseDocumentationGroup[]): JourneyRunSpan[] {
  const phasesByRun = new Map<string, QuestPhaseDocumentationGroup[]>();
  for (const group of groups) {
    if (!group.journeyRunId || !group.startedAt) continue;
    const phases = phasesByRun.get(group.journeyRunId);
    if (phases) phases.push(group);
    else phasesByRun.set(group.journeyRunId, [group]);
  }
  const runs = [...phasesByRun.values()]
    .map((phases) => phases.sort((a, b) => a.startedAt! - b.startedAt!))
    .sort((a, b) => a[0]!.startedAt! - b[0]!.startedAt!);

  return runs.map((phases, runIndex) => {
    const isLatestRun = runIndex === runs.length - 1;
    const lastActivity = Math.max(
      ...phases.flatMap((phase) => [phase.startedAt!, phase.completedAt ?? 0, ...phase.entries.map((e) => e.ts)]),
    );
    const open = isLatestRun && phases.at(-1)!.phaseStatus === "active";
    const nextRunStart = runs[runIndex + 1]?.[0]?.startedAt ?? Number.POSITIVE_INFINITY;
    return {
      start: phases[0]!.startedAt!,
      end: Math.min(open ? Number.POSITIVE_INFINITY : lastActivity, nextRunStart - 1),
      phases,
    };
  });
}
