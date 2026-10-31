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

  for (const row of orderLeaderActivePhaseRows(board)) {
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

/** Board rows not being worked on: they get no phase dot. */
const NOT_IN_MOTION_STATUSES = new Set(["QUEUED", "PROPOSED"]);

/**
 * The phase dots of a leader's Overview button: one `questId:phaseId` per board quest in a Journey
 * phase (Work, User Checkpoint, Memory, Landing, ...), in board order. Queued and proposed quests
 * are not being worked on and get none.
 */
export function activePhaseDotKeys(board: readonly LeaderActivePhaseSummaryRow[]): string[] {
  const keys: string[] = [];
  for (const row of orderLeaderActivePhaseRows(board)) {
    if (NOT_IN_MOTION_STATUSES.has((row.status ?? "").trim().toUpperCase())) continue;
    const phase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
    if (phase) keys.push(`${row.questId}:${phase.id}`);
  }
  return keys;
}

export function orderLeaderActivePhaseRows<Row extends LeaderActivePhaseSummaryRow>(board: readonly Row[]): Row[] {
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
