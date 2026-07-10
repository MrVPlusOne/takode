import {
  CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
  CODEX_LEADER_RECYCLE_BUFFER_TOKENS,
} from "../shared/session-defaults.js";

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function effectiveContextPercentFromModelEntry(modelEntry: Record<string, any> | undefined): number {
  return positiveNumber(modelEntry?.effective_context_window_percent) || CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
}

export function rawContextWindowForUsableCapacity(usableContextWindow: number, effectivePercent: number): number {
  return Math.max(1, Math.ceil((usableContextWindow * 100) / effectivePercent));
}

export function sourceRawContextWindowForLeaderUsableCapacity(
  usableContextWindow: number,
  effectivePercent: number,
): number {
  return rawContextWindowForUsableCapacity(usableContextWindow + CODEX_LEADER_RECYCLE_BUFFER_TOKENS, effectivePercent);
}

export function leaderRecycleThresholdForUsableCapacity(usableContextWindow: number) {
  return {
    recycleThresholdTokens: usableContextWindow,
    sourceEffectiveContextWindowTokens: usableContextWindow + CODEX_LEADER_RECYCLE_BUFFER_TOKENS,
    usedFallback: false,
    source: "configured usable capacity",
  };
}
