import type { ActiveCodexReasoningPreview } from "../types.js";
import { normalizeThreadKey } from "./thread-projection.js";

export function indexCodexReasoningPreviews(
  previews: readonly ActiveCodexReasoningPreview[],
): Map<string, ActiveCodexReasoningPreview> {
  const indexed = new Map<string, ActiveCodexReasoningPreview>();
  for (const preview of previews) {
    if ((!preview.threadKey && !preview.questId) || !preview.text.trim()) continue;
    const threadKey = normalizeThreadKey(preview.threadKey ?? preview.questId ?? "");
    if (threadKey === "all") continue;
    indexed.set(threadKey, preview);
  }
  return indexed;
}
