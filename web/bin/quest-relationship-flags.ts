import type { QuestRelationships } from "../server/quest-types.js";
import { normalizeQuestRelationshipId } from "../server/quest-relationships.js";

export function parseRelationshipFlags(args: {
  clearFollowUpOf?: boolean;
  option: (name: string) => string | undefined;
}): QuestRelationships | undefined {
  if (args.clearFollowUpOf) return { followUpOf: [] };
  const rawFollowUpOf = args.option("follow-up-of");
  if (rawFollowUpOf === undefined) return undefined;
  const followUpOf = rawFollowUpOf
    .split(",")
    .map((value) => normalizeQuestRelationshipId(value))
    .filter((questId): questId is string => !!questId);
  return { followUpOf: Array.from(new Set(followUpOf)) };
}

/**
 * `--source-message uN`: the user's message this quest was filed from, by the `id:uN` its
 * source tag showed. The server resolves the ID in the calling session's conversation.
 */
export function parseSourceMessageFlag(
  option: (name: string) => string | undefined,
): { startedFromUserMessageId: string } | Record<string, never> {
  const raw = option("source-message")?.trim();
  if (raw === undefined) return {};
  if (!/^u\d+$/.test(raw)) throw new Error(`--source-message takes a user message ID like u12, not "${raw}"`);
  return { startedFromUserMessageId: raw };
}
