export interface CompactionBoundaryMessage {
  type: "compact_boundary";
  id?: string;
  timestamp?: number;
  trigger?: string;
  preTokens?: number;
  compactionStatus?: "started" | "completed";
}

export interface CompactionMarkerMessage {
  type: "compact_marker";
  timestamp: number;
  id?: string;
  cliUuid?: string;
  summary?: string;
  markerKind?: "compaction" | "session_recycled";
  compactionStatus?: "started" | "completed";
  trigger?: string;
  preTokens?: number;
}

export function compactionMarkerLabel(status?: "started" | "completed", kind?: string): string {
  if (kind === "session_recycled") return "Session recycled";
  return status === "started" ? "Compaction started" : "Conversation compacted";
}
