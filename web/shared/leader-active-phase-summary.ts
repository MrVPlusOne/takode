import {
  QUEST_JOURNEY_STATES,
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyPhase,
  getQuestJourneyPresentation,
  type QuestJourneyPlanState,
} from "./quest-journey.js";

export interface LeaderActivePhaseSummaryRow {
  questId: string;
  journey?: QuestJourneyPlanState;
  status?: string;
  updatedAt?: number;
}

export interface LeaderActivePhaseSummarySegment {
  label: string;
  count: number;
  tone: "phase" | "status" | "unknown";
  color?: string;
  colorName?: string;
}

const JOURNEY_STATUS_PRIORITY = new Map([...QUEST_JOURNEY_STATES].reverse().map((status, index) => [status, index]));

export function buildLeaderActivePhaseSummary(
  board: readonly LeaderActivePhaseSummaryRow[],
): LeaderActivePhaseSummarySegment[] {
  const counts = new Map<
    string,
    { count: number; tone: LeaderActivePhaseSummarySegment["tone"]; color?: string; colorName?: string }
  >();

  for (const row of orderActiveRows(board)) {
    const currentPhase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
    const presentation = getQuestJourneyPresentation(row.status);
    const label = currentPhase?.label ?? presentation?.label ?? row.status ?? "unknown";
    const tone = currentPhase ? "phase" : presentation ? "status" : "unknown";
    const color = currentPhase?.color.accent;
    const colorName = currentPhase?.color.name;
    const entry = counts.get(label);
    if (entry) {
      entry.count += 1;
      continue;
    }
    counts.set(label, { count: 1, tone, ...(color ? { color } : {}), ...(colorName ? { colorName } : {}) });
  }

  return [...counts.entries()].map(([label, { count, tone, color, colorName }]) => ({
    label,
    count,
    tone,
    ...(color ? { color } : {}),
    ...(colorName ? { colorName } : {}),
  }));
}

function orderActiveRows(board: readonly LeaderActivePhaseSummaryRow[]): LeaderActivePhaseSummaryRow[] {
  return [...board].sort((a, b) => {
    const byPriority = statusPriority(a.status) - statusPriority(b.status);
    if (byPriority !== 0) return byPriority;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.questId.localeCompare(b.questId);
  });
}

function statusPriority(status?: string): number {
  if (!status) return Number.MAX_SAFE_INTEGER - 1;
  return JOURNEY_STATUS_PRIORITY.get(status as (typeof QUEST_JOURNEY_STATES)[number]) ?? Number.MAX_SAFE_INTEGER;
}
