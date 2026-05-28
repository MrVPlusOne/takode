export const CODEX_LEADER_RECYCLE_BUFFER_TOKENS = 25_000;
export const CODEX_LEADER_RECYCLE_FALLBACK_THRESHOLD_TOKENS = 260_000;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

export function deriveCodexLeaderRecycleThresholdTokens(
  effectiveContextWindowTokens: unknown,
  bufferTokens = CODEX_LEADER_RECYCLE_BUFFER_TOKENS,
): number | undefined {
  const effectiveContextWindow = positiveInteger(effectiveContextWindowTokens);
  const buffer = positiveInteger(bufferTokens);
  if (!effectiveContextWindow || !buffer) return undefined;
  return Math.max(1, effectiveContextWindow - buffer);
}

export function resolveCodexLeaderRecycleThresholdTokensFromEffectiveContext(
  effectiveContextWindowTokens: unknown,
): number {
  return (
    deriveCodexLeaderRecycleThresholdTokens(effectiveContextWindowTokens) ??
    CODEX_LEADER_RECYCLE_FALLBACK_THRESHOLD_TOKENS
  );
}
