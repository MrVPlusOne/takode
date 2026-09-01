import type { LeaderThreadTabsProjectionJourney } from "../../../shared/leader-thread-tabs-projection.js";
import { summarizeQuestJourneyDurations } from "../../../shared/quest-journey.js";
import type { BoardRowData } from "../BoardTable.js";

/** Build the same compact Journey shape that the synchronized server projection sends to Playground clients. */
export function buildPlaygroundProjectedJourney(
  row: BoardRowData | undefined,
  completed: boolean,
): LeaderThreadTabsProjectionJourney | null {
  if (!row?.journey) return null;
  const phaseIds = row.journey.phaseIds.slice(0, 100);
  const durationSummary = summarizeQuestJourneyDurations(row.journey, row.status, {
    allowActiveElapsed: !completed,
    maxPhaseCount: phaseIds.length,
  });
  return {
    mode: row.journey.mode ?? null,
    phaseIds,
    currentPhaseId: row.journey.currentPhaseId ?? null,
    activePhaseIndex: row.journey.activePhaseIndex ?? null,
    phaseCount: phaseIds.length,
    durationSummary,
  };
}
