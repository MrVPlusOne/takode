export const CODEX_LEADER_COMPACTION_MODES = ["recycle", "compact"] as const;

export type CodexLeaderCompactionMode = (typeof CODEX_LEADER_COMPACTION_MODES)[number];

export const DEFAULT_CODEX_LEADER_COMPACTION_MODE: CodexLeaderCompactionMode = "recycle";

export function normalizeCodexLeaderCompactionMode(value: unknown): CodexLeaderCompactionMode {
  return value === "compact" ? "compact" : DEFAULT_CODEX_LEADER_COMPACTION_MODE;
}

export function isCodexLeaderRecycleMode(value: unknown): boolean {
  return normalizeCodexLeaderCompactionMode(value) === "recycle";
}
