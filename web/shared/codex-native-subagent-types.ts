/**
 * Browser-safe Codex native-subagent contracts.
 *
 * Provider thread/turn identifiers never belong in these DTOs. The server maps
 * them to session-scoped opaque child IDs and authoritative feed turn keys.
 */
export const CODEX_NATIVE_SUBAGENT_STATUSES = [
  "starting",
  "working",
  "waiting",
  "done",
  "failed",
  "interrupted",
  "unknown",
] as const;

export type CodexNativeSubagentStatus = (typeof CODEX_NATIVE_SUBAGENT_STATUSES)[number];

export type CodexNativeSubagentCoverage = "complete" | "partial";

export type CodexNativeSubagentTranscriptAvailability = "available" | "partial" | "unavailable";

export type CodexNativeSubagentStatusCounts = Record<CodexNativeSubagentStatus, number>;

/** Ownership metadata attached to forward-captured child messages/items. */
export interface CodexNativeSubagentOwnership {
  childId: string;
  parentChildId?: string;
  rootTurnId: string;
}

/** Copies only fields allowed to cross the server-to-browser ownership boundary. */
export function toPublicCodexNativeSubagentOwnership(
  ownership: CodexNativeSubagentOwnership,
): CodexNativeSubagentOwnership {
  return {
    childId: ownership.childId,
    ...(ownership.parentChildId ? { parentChildId: ownership.parentChildId } : {}),
    rootTurnId: ownership.rootTurnId,
  };
}

export interface CodexNativeSubagentSummary extends CodexNativeSubagentOwnership {
  /** Provider-authored logical task path, not a rollout or filesystem path. */
  agentPath: string;
  displayName: string;
  nickname?: string;
  role?: string;
  depth: number;
  spawnOrder: number;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  status: CodexNativeSubagentStatus;
  statusObservedAt: number;
  transcriptAvailability: CodexNativeSubagentTranscriptAvailability;
  /** Relationship capability is intentionally separate from lifecycle state. */
  followUpAvailable?: boolean;
}

export interface CodexNativeSubagentTurnAggregate {
  rootTurnId: string;
  total: number;
  statusCounts: CodexNativeSubagentStatusCounts;
  status: CodexNativeSubagentStatus;
  coverage: CodexNativeSubagentCoverage;
}

export interface CodexNativeSubagentSessionAggregate {
  total: number;
  statusCounts: CodexNativeSubagentStatusCounts;
  activeCount: number;
  unresolvedCount: number;
}

export interface CodexNativeSubagentSnapshot {
  revision: number;
  coverage: CodexNativeSubagentCoverage;
  session: CodexNativeSubagentSessionAggregate;
  children: CodexNativeSubagentSummary[];
  turns: Record<string, CodexNativeSubagentTurnAggregate>;
}
