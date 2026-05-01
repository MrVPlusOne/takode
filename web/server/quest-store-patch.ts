import type { QuestDone, QuestFeedbackEntry, QuestPatchInput, QuestmasterTask } from "./quest-types.js";
import { hasQuestReviewMetadata } from "./quest-types.js";
import { normalizeTldr } from "./quest-tldr.js";
import { normalizeQuestRelationships } from "./quest-relationships.js";
import { shouldMarkVerificationInboxUnreadFromFeedbackPatch } from "./quest-store-helpers.js";

export function applyQuestPatch(current: QuestmasterTask, questId: string, patch: QuestPatchInput): QuestmasterTask {
  const markVerificationInboxUnread = shouldMarkVerificationInboxUnreadFromFeedbackPatch(current, patch.feedback);
  const updated = { ...current, updatedAt: Date.now() } as QuestmasterTask;
  if (patch.title !== undefined) (updated as { title: string }).title = patch.title.trim();
  if (patch.description !== undefined) (updated as { description?: string }).description = patch.description.trim();
  if (patch.tldr !== undefined) {
    const tldr = normalizeTldr(patch.tldr);
    if (tldr) (updated as { tldr?: string }).tldr = tldr;
    else delete (updated as { tldr?: string }).tldr;
  }
  if (patch.tags !== undefined) (updated as { tags?: string[] }).tags = patch.tags;
  if (patch.relationships !== undefined) {
    const relationships = normalizeQuestRelationships(patch.relationships, questId);
    if (relationships) (updated as { relationships?: QuestmasterTask["relationships"] }).relationships = relationships;
    else delete (updated as { relationships?: QuestmasterTask["relationships"] }).relationships;
  }
  if (patch.feedback !== undefined) {
    (updated as { feedback?: QuestFeedbackEntry[] }).feedback = patch.feedback.length > 0 ? patch.feedback : undefined;
  }
  if (patch.journeyRuns !== undefined) {
    (updated as { journeyRuns?: QuestmasterTask["journeyRuns"] }).journeyRuns =
      patch.journeyRuns.length > 0 ? patch.journeyRuns : undefined;
  }
  if (markVerificationInboxUnread && hasQuestReviewMetadata(updated)) {
    (updated as QuestDone).verificationInboxUnread = true;
  }
  return updated;
}
