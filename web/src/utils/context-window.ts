import type { ModelOption } from "./backends.js";
import { formatContextWindowLabel } from "./token-format.js";
import { CODEX_LEADER_RECYCLE_BUFFER_TOKENS } from "../../shared/session-defaults.js";

export function effectiveContextPercentForModel(model: ModelOption | undefined, fallbackPercent: number): number {
  const metadataPercent = model?.effectiveContextWindowPercent;
  if (metadataPercent && Number.isSafeInteger(metadataPercent) && metadataPercent >= 1 && metadataPercent <= 100) {
    return metadataPercent;
  }
  return fallbackPercent;
}

export function estimateUsableContextWindow(rawContextWindow: number | null | undefined, effectivePercent: number) {
  if (!rawContextWindow || rawContextWindow < 1) return null;
  return Math.max(1, Math.floor((rawContextWindow * effectivePercent) / 100));
}

export function deriveRawContextWindowForUsableCapacity(
  usableContextWindow: number | null | undefined,
  effectivePercent: number,
): number | null {
  if (!usableContextWindow || usableContextWindow < 1) return null;
  return Math.max(1, Math.ceil((usableContextWindow * 100) / effectivePercent));
}

export function deriveLeaderSourceRawContextWindowForUsableCapacity(
  usableContextWindow: number | null | undefined,
  effectivePercent: number,
): number | null {
  if (!usableContextWindow || usableContextWindow < 1) return null;
  return deriveRawContextWindowForUsableCapacity(
    usableContextWindow + CODEX_LEADER_RECYCLE_BUFFER_TOKENS,
    effectivePercent,
  );
}

export function contextWindowPreview(
  usableContextWindow: number | null | undefined,
  effectivePercent: number,
  options?: { leader?: boolean },
): string {
  if (!usableContextWindow) {
    return options?.leader
      ? "Empty leaves the leader's model-derived recycle budget unchanged."
      : "Empty leaves the selected model/backend usable capacity unchanged.";
  }
  if (options?.leader) {
    const sourceRaw = deriveLeaderSourceRawContextWindowForUsableCapacity(usableContextWindow, effectivePercent);
    const sourceEffective = usableContextWindow + CODEX_LEADER_RECYCLE_BUFFER_TOKENS;
    return `Targets ${formatContextWindowLabel(usableContextWindow)} leader usable capacity; requests about ${formatContextWindowLabel(
      sourceRaw!,
    )} raw source context (${formatContextWindowLabel(sourceEffective)} effective before the leader buffer).`;
  }
  const raw = deriveRawContextWindowForUsableCapacity(usableContextWindow, effectivePercent);
  return `Targets ${formatContextWindowLabel(usableContextWindow)} usable capacity; requests about ${formatContextWindowLabel(
    raw!,
  )} raw context at ${effectivePercent}%.`;
}

export function contextWindowLimitWarning(
  usableContextWindow: number | null | undefined,
  model: ModelOption | undefined,
  options?: { leader?: boolean; effectivePercent?: number },
): string | null {
  const knownMax = model?.maxContextWindow ?? model?.contextWindow;
  if (!usableContextWindow || !knownMax) return null;
  const effectivePercent = options?.effectivePercent ?? effectiveContextPercentForModel(model, 95);
  const requestedRaw = options?.leader
    ? deriveLeaderSourceRawContextWindowForUsableCapacity(usableContextWindow, effectivePercent)
    : deriveRawContextWindowForUsableCapacity(usableContextWindow, effectivePercent);
  if (!requestedRaw || requestedRaw <= knownMax) return null;
  return `Selected model metadata reports ${formatContextWindowLabel(
    knownMax,
  )} raw max. Takode will save this usable target because local metadata can be stale.`;
}
