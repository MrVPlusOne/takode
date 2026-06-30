import type { ModelOption } from "./backends.js";
import { formatContextWindowLabel } from "./token-format.js";

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

export function contextWindowPreview(rawContextWindow: number | null | undefined, effectivePercent: number): string {
  const usable = estimateUsableContextWindow(rawContextWindow, effectivePercent);
  if (!usable) return `Codex may reserve part of the raw context; /status shows the usable window.`;
  return `Estimated /status window: ${formatContextWindowLabel(usable)} usable from ${formatContextWindowLabel(
    rawContextWindow!,
  )} raw at ${effectivePercent}%.`;
}

export function contextWindowLimitWarning(
  rawContextWindow: number | null | undefined,
  model: ModelOption | undefined,
): string | null {
  const knownMax = model?.maxContextWindow ?? model?.contextWindow;
  if (!rawContextWindow || !knownMax || rawContextWindow <= knownMax) return null;
  return `Selected model metadata reports ${formatContextWindowLabel(
    knownMax,
  )} raw max. Takode will save this as requested because local metadata can be stale.`;
}
