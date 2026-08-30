export const COMPACTION_RECOVERY_SOURCE_ID = "system:compaction-recovery";
export const COMPACTION_RECOVERY_SOURCE_LABEL = "Compaction Recovery";
export const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID = "system:codex-leader-recovery-diagnostic";
export const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL = "Codex Recovery Diagnostic";
export const LEADER_KICKOFF_SOURCE_ID = "system:leader-kickoff";
export const LEADER_KICKOFF_SOURCE_LABEL = "Leader Kickoff";
export const LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX = "system:leader-skill-preload:";
export const LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX = "Required leader skill preloaded";
export const MEMORY_CATALOG_SOURCE_ID = "system:memory-catalog";
export const CODEX_TURN_RECOVERY_SOURCE_ID_PREFIX = "system:codex-turn-recovery:";
export const CODEX_TURN_RECOVERY_SOURCE_LABEL = "Interrupted Turn Recovery";
export const MEMORY_CATALOG_SOURCE_LABEL = "Memory Catalog";
export const MEMORY_CATALOG_TITLE = "Memory catalog preloaded";
export const MEMORY_CATALOG_TRUNCATED_PREFIX = "⚠ Memory catalog truncated:";
export const MEMORY_CATALOG_UNAVAILABLE_PREFIX = "⚠ Memory catalog unavailable:";

export const LEADER_COMPACTION_RECOVERY_PREFIX =
  "Context was compacted. Before continuing, recover enough context to safely resume orchestration:";

export const STANDARD_COMPACTION_RECOVERY_PREFIX =
  "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:";

export const LEADER_KICKOFF_PREFIX = "[System] You are a leader session.";

const RESTART_CONTINUATION_SOURCE_ID_PREFIX = "system:restart-continuation:";
const OMITTED_HERD_CONTEXT_SOURCE_LABELS = new Set([
  MEMORY_CATALOG_SOURCE_LABEL,
  COMPACTION_RECOVERY_SOURCE_LABEL,
  LEADER_KICKOFF_SOURCE_LABEL,
]);

export interface OmittedHerdContextSource {
  sourceLabel: string;
}

/**
 * Identify structured bootstrap/recovery context whose complete body belongs in
 * the source session history, not in a leader-model herd activity summary.
 * Decision-bearing reminders and diagnostics intentionally remain visible.
 */
export function getOmittedHerdContextSource(
  agentSource:
    | {
        sessionId?: string;
        sessionLabel?: string;
      }
    | undefined,
): OmittedHerdContextSource | null {
  const sourceId = agentSource?.sessionId;
  if (sourceId === MEMORY_CATALOG_SOURCE_ID) {
    return { sourceLabel: MEMORY_CATALOG_SOURCE_LABEL };
  }
  if (sourceId === COMPACTION_RECOVERY_SOURCE_ID) {
    return { sourceLabel: COMPACTION_RECOVERY_SOURCE_LABEL };
  }
  if (sourceId === LEADER_KICKOFF_SOURCE_ID) {
    return { sourceLabel: LEADER_KICKOFF_SOURCE_LABEL };
  }
  if (isLeaderSkillPreloadSourceId(sourceId)) {
    return { sourceLabel: agentSource?.sessionLabel || LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX };
  }
  if (sourceId?.startsWith(RESTART_CONTINUATION_SOURCE_ID_PREFIX)) {
    return { sourceLabel: "Restart Continuation" };
  }

  // Legacy persisted entries may lack the stable source id. Exact known labels
  // are safe fallbacks; generic labels such as "System" are intentionally not.
  const sourceLabel = agentSource?.sessionLabel;
  const hasLegacySystemSource = !sourceId || sourceId === "system" || sourceId.startsWith("system:");
  if (hasLegacySystemSource && sourceLabel && OMITTED_HERD_CONTEXT_SOURCE_LABELS.has(sourceLabel)) {
    return { sourceLabel };
  }
  if (hasLegacySystemSource && sourceLabel?.startsWith(`${LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX}:`)) {
    return { sourceLabel };
  }
  return null;
}

export function codexTurnRecoverySourceId(recoveryId: string): string {
  return CODEX_TURN_RECOVERY_SOURCE_ID_PREFIX + recoveryId;
}

export function isCodexTurnRecoverySourceId(sourceId: string | undefined): boolean {
  return sourceId?.startsWith(CODEX_TURN_RECOVERY_SOURCE_ID_PREFIX) === true;
}

export function isSystemSourceId(sourceId: string | undefined): boolean {
  return sourceId === "system" || sourceId?.startsWith("system:") === true;
}

export function isCodexLeaderRecoveryDiagnosticSourceId(sourceId: string | undefined): boolean {
  return sourceId === CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID;
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
