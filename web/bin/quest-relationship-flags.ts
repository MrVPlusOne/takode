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
