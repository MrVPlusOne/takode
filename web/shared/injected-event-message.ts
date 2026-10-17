export const COMPACTION_RECOVERY_SOURCE_ID = "system:compaction-recovery";
export const COMPACTION_RECOVERY_SOURCE_LABEL = "Compaction Recovery";
export const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID = "system:codex-leader-recovery-diagnostic";
export const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL = "Why Automatic Retry Stopped";
export const LEADER_KICKOFF_SOURCE_ID = "system:leader-kickoff";
export const LEADER_KICKOFF_SOURCE_LABEL = "Leader Kickoff";
export const LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX = "system:leader-skill-preload:";
export const LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX = "Required leader skill preloaded";
export const MEMORY_CATALOG_SOURCE_ID = "system:memory-catalog";
/** Sender of the notice telling a session that skills it loaded have changed since. */
export const SKILL_CHANGE_NOTICE_SOURCE_ID = "system:skill-change-notice";
/** Sender of the notice telling a session's agent what Takode rebuilt before its launch. */
export const SESSION_RECOVERY_SOURCE_ID = "system:session-recovery";
export const CODEX_TURN_RECOVERY_SOURCE_ID_PREFIX = "system:codex-turn-recovery:";
export const CODEX_TURN_RECOVERY_SOURCE_LABEL = "Resuming Interrupted Work";
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

const SESSION_SOURCE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a user-shaped message was sent by another session with `takode send`, not
 * injected by Takode itself: Takode's own sources (herd events, timers, reminders,
 * the landing queue) use fixed names, while a sending session is identified by its
 * UUID. Only a leader may send to a leader, so in a leader session this is another
 * leader's message, which starts its own feed turn like the user's.
 */
export function isSessionSentSourceId(sourceId: string | undefined): boolean {
  return sourceId !== undefined && SESSION_SOURCE_ID_RE.test(sourceId);
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
