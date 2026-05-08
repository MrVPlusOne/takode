export const COMPACTION_RECOVERY_SOURCE_ID = "system:compaction-recovery";
export const COMPACTION_RECOVERY_SOURCE_LABEL = "Compaction Recovery";
export const LEADER_KICKOFF_SOURCE_ID = "system:leader-kickoff";
export const LEADER_KICKOFF_SOURCE_LABEL = "Leader Kickoff";

export const LEADER_COMPACTION_RECOVERY_PREFIX =
  "Context was compacted. Before continuing, recover enough context to safely resume orchestration:";

export const STANDARD_COMPACTION_RECOVERY_PREFIX =
  "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:";

export const LEADER_KICKOFF_PREFIX = "[System] You are a leader session.";

export function isSystemSourceId(sourceId: string | undefined): boolean {
  return sourceId === "system" || sourceId?.startsWith("system:") === true;
}

export function isCompactionRecoveryPrompt(content: string): boolean {
  return (
    content.startsWith(LEADER_COMPACTION_RECOVERY_PREFIX) || content.startsWith(STANDARD_COMPACTION_RECOVERY_PREFIX)
  );
}

export function isLeaderKickoffPrompt(content: string): boolean {
  return content.startsWith(LEADER_KICKOFF_PREFIX);
}
