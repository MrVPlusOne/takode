import type { ChatMessage } from "../types.js";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
  LEADER_KICKOFF_SOURCE_ID,
  LEADER_KICKOFF_SOURCE_LABEL,
  LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX,
  MEMORY_CATALOG_SOURCE_LABEL,
  MEMORY_CATALOG_TITLE,
  isCompactionRecoveryPrompt,
  isLeaderKickoffPrompt,
  isLeaderSkillPreloadSourceId,
  isMemoryCatalogSourceId,
  isMemoryCatalogTruncationWarning,
  isMemoryCatalogUnavailableWarning,
  isSystemSourceId,
} from "../../shared/injected-event-message.js";

export interface InjectedEventMessageViewModel {
  title: string;
  description: string;
  rawContent: string;
  tone?: "warning";
}

type EventCandidate = Pick<ChatMessage, "agentSource" | "content">;

export function buildInjectedEventMessageViewModel(message: EventCandidate): InjectedEventMessageViewModel | null {
  if (!message.content.trim()) return null;
  const sourceId = message.agentSource?.sessionId;

  if (
    sourceId === COMPACTION_RECOVERY_SOURCE_ID ||
    (isSystemSourceId(sourceId) && isCompactionRecoveryPrompt(message.content))
  ) {
    return {
      title: COMPACTION_RECOVERY_SOURCE_LABEL,
      description: "System-injected recovery instructions after context compaction.",
      rawContent: message.content,
    };
  }

  if (sourceId === LEADER_KICKOFF_SOURCE_ID || (!sourceId && isLeaderKickoffPrompt(message.content))) {
    return {
      title: LEADER_KICKOFF_SOURCE_LABEL,
      description: "System-injected startup instructions for a leader session.",
      rawContent: message.content,
    };
  }

  if (isLeaderSkillPreloadSourceId(sourceId)) {
    const firstLine = message.content.split(/\r?\n/, 1)[0]?.trim();
    return {
      title: firstLine?.startsWith(LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX)
        ? firstLine
        : "Required leader skill preloaded",
      description: "System-injected mandatory leader skill content.",
      rawContent: message.content,
    };
  }

  if (isMemoryCatalogSourceId(sourceId)) {
    const hasWarning =
      isMemoryCatalogTruncationWarning(message.content) || isMemoryCatalogUnavailableWarning(message.content);
    return {
      title: MEMORY_CATALOG_TITLE || MEMORY_CATALOG_SOURCE_LABEL,
      description: hasWarning
        ? "System-injected memory catalog context needs attention before relying on memory facts."
        : "System-injected memory catalog context for orientation. Inspect memory files directly before relying on facts.",
      rawContent: message.content,
      ...(hasWarning ? { tone: "warning" as const } : {}),
    };
  }

  return null;
}

export function isInjectedEventMessage(message: EventCandidate): boolean {
  return buildInjectedEventMessageViewModel(message) !== null;
}
