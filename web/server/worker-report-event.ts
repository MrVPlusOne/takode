import { getQuestJourneyCurrentPhaseIndex, getQuestJourneyCurrentPhaseId } from "../shared/quest-journey.js";
import type { BoardRow, TakodeEvent } from "./session-types.js";

/** Reports remain readable in feedback, but stale occurrences must not prompt a new Work turn. */
export function isCurrentWorkerReport(event: TakodeEvent, leaderId: string, board?: Map<string, BoardRow>): boolean {
  if (event.event !== "worker_stream" || !event.data.report) return true;
  const report = event.data.report;
  const row = event.data.questId ? board?.get(event.data.questId) : undefined;
  return !!(
    report.leaderSessionId === leaderId &&
    row?.worker === event.sessionId &&
    row.status === "WORKING" &&
    row.createdAt === report.boardCreatedAt &&
    getQuestJourneyCurrentPhaseId(row.journey, row.status) === "work" &&
    getQuestJourneyCurrentPhaseIndex(row.journey, row.status) === report.phasePosition - 1
  );
}
