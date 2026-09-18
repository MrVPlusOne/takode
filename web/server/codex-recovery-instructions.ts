import {
  getLeaderContextRecoveryInstructions,
  getStandardContextRecoveryInstructions,
} from "./compaction-recovery-prompts.js";
import {
  buildLeaderPreloadDeliveryContent,
  buildLeaderSkillPreloadBundles,
  type LeaderSkillPreloadBundle,
} from "./leader-skill-preload.js";

/** Codex restores developer instructions before both pre-turn and in-turn compaction continuations. */
export async function buildCodexRecoveryInstructions(
  instructions: string | undefined,
  role: "leader" | "standard" | undefined,
  sessionRef: string,
  buildSkills: () => Promise<LeaderSkillPreloadBundle[]> = buildLeaderSkillPreloadBundles,
): Promise<string | undefined> {
  if (!role) return instructions;
  const recovery =
    role === "leader"
      ? buildLeaderPreloadDeliveryContent(getLeaderContextRecoveryInstructions(sessionRef), await buildSkills())
      : getStandardContextRecoveryInstructions(sessionRef);
  return [
    instructions,
    "## Recovery after compaction",
    "The following recovery guidance applies after context compaction. It is part of the session instructions restored by Codex before continuation; no separate recovery message is required.",
    recovery,
  ]
    .filter(Boolean)
    .join("\n\n");
}
