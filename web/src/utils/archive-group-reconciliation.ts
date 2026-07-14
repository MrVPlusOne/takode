import type { ArchiveGroupResponse } from "../api.js";

type ArchiveGroupMember = { sessionId: string };

export function archiveGroupRequestIds(leaderId: string, workers: ReadonlyArray<ArchiveGroupMember>): string[] {
  return [leaderId, ...workers.map((worker) => worker.sessionId)];
}

export function archiveGroupSuccessfulIds(
  leaderId: string,
  workers: ReadonlyArray<ArchiveGroupMember>,
  result: ArchiveGroupResponse,
): Set<string> {
  if (!Array.isArray(result.results) || result.results.length === 0) {
    return new Set(archiveGroupRequestIds(leaderId, workers));
  }
  return new Set(result.results.filter((entry) => entry.ok).map((entry) => entry.sessionId));
}

export function archiveGroupNavigationExcludedIds(
  leaderId: string,
  workers: ReadonlyArray<ArchiveGroupMember>,
): Set<string> {
  return new Set(archiveGroupRequestIds(leaderId, workers));
}
