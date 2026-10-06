/** Compact identity and preview of a report whose complete text lives in quest feedback. */
export interface WorkerReportReference {
  id: string;
  leaderSessionId: string;
  journeyRunId: string;
  phaseOccurrenceId: string;
  phasePosition: number;
  boardCreatedAt: number;
  feedbackIndex: number;
  preview: string;
}

/** Format the report's compact herd header with its exact feedback source, without turn activity. */
export function formatWorkerReport(questId: string, report: WorkerReportReference, workerLabel: string): string {
  return `${workerLabel} | worker_stream | report (informational; no acknowledgment required) | [${questId} feedback #${report.feedbackIndex}](quest:${questId}:feedback:${report.feedbackIndex}) | ${report.preview}`;
}
