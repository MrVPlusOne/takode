export const COMPACTION_RECOVERY_SOURCE_ID = "system:compaction-recovery";
export const COMPACTION_RECOVERY_SOURCE_LABEL = "Compaction Recovery";
export const LEADER_KICKOFF_SOURCE_ID = "system:leader-kickoff";
export const LEADER_KICKOFF_SOURCE_LABEL = "Leader Kickoff";
export const LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX = "system:leader-skill-preload:";
export const LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX = "Required leader skill preloaded";
export const MEMORY_CATALOG_SOURCE_ID = "system:memory-catalog";
export const MEMORY_CATALOG_SOURCE_LABEL = "Memory Catalog";
export const MEMORY_CATALOG_TITLE = "Memory catalog preloaded";
export const MEMORY_CATALOG_TRUNCATED_PREFIX = "⚠ Memory catalog truncated:";
export const MEMORY_CATALOG_UNAVAILABLE_PREFIX = "⚠ Memory catalog unavailable:";

export const LEADER_COMPACTION_RECOVERY_PREFIX =
  "Context was compacted. Before continuing, recover enough context to safely resume orchestration:";

export const STANDARD_COMPACTION_RECOVERY_PREFIX =
  "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:";

export const LEADER_KICKOFF_PREFIX = "[System] You are a leader session.";

export function isSystemSourceId(sourceId: string | undefined): boolean {
  return sourceId === "system" || sourceId?.startsWith("system:") === true;
}

export function isLeaderSkillPreloadSourceId(sourceId: string | undefined): boolean {
  return sourceId?.startsWith(LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX) === true;
}

export function isMemoryCatalogSourceId(sourceId: string | undefined): boolean {
  return sourceId === MEMORY_CATALOG_SOURCE_ID;
}

export function leaderSkillPreloadSourceId(skillName: string): string {
  return LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX + skillName;
}

export function leaderSkillPreloadSourceLabel(skillName: string): string {
  return `${LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX}: ${skillName}`;
}

export function isCompactionRecoveryPrompt(content: string): boolean {
  return (
    content.startsWith(LEADER_COMPACTION_RECOVERY_PREFIX) || content.startsWith(STANDARD_COMPACTION_RECOVERY_PREFIX)
  );
}

export function isLeaderKickoffPrompt(content: string): boolean {
  return content.startsWith(LEADER_KICKOFF_PREFIX);
}

export function isMemoryCatalogTruncationWarning(content: string): boolean {
  return content.includes(MEMORY_CATALOG_TRUNCATED_PREFIX);
}

export function isMemoryCatalogUnavailableWarning(content: string): boolean {
  return content.includes(MEMORY_CATALOG_UNAVAILABLE_PREFIX);
}
