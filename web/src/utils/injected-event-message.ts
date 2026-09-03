import type { ChatMessage } from "../types.js";
import {
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  LEADER_KICKOFF_SOURCE_ID,
  LEADER_KICKOFF_SOURCE_LABEL,
  LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX,
  MEMORY_CATALOG_SOURCE_LABEL,
  MEMORY_CATALOG_TITLE,
  isCodexTurnRecoverySourceId,
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
  messageSizeChars: number;
  tone?: "warning";
}

type EventCandidate = Pick<ChatMessage, "agentSource" | "content" | "modelDeliveryContent">;

function withRawContent(
  message: EventCandidate,
  event: Omit<InjectedEventMessageViewModel, "rawContent" | "messageSizeChars">,
  rawContent = message.content,
): InjectedEventMessageViewModel {
  return {
    ...event,
    rawContent,
    messageSizeChars: rawContent.length,
  };
}

export function getRecoveryModelDeliveryContent(message: EventCandidate): string | undefined {
  if (!isCodexTurnRecoverySourceId(message.agentSource?.sessionId)) return undefined;
  return typeof message.modelDeliveryContent === "string" ? message.modelDeliveryContent : undefined;
}

export function buildInjectedEventMessageViewModel(message: EventCandidate): InjectedEventMessageViewModel | null {
  if (!message.content.trim()) return null;
  const sourceId = message.agentSource?.sessionId;

  if (isCodexTurnRecoverySourceId(sourceId)) {
    const modelDeliveryContent = getRecoveryModelDeliveryContent(message);
    return withRawContent(
      message,
      {
        title: CODEX_TURN_RECOVERY_SOURCE_LABEL,
        description:
          modelDeliveryContent !== undefined
            ? "Exact model-bound recovery instructions recorded by Takode for this follow-up. This does not by itself prove Codex received or completed them."
            : "Takode added one recovery follow-up without replaying the original input.",
      },
      modelDeliveryContent ?? message.content,
    );
  }

  if (
    sourceId === COMPACTION_RECOVERY_SOURCE_ID ||
    (isSystemSourceId(sourceId) && isCompactionRecoveryPrompt(message.content))
  ) {
    return withRawContent(message, {
      title: COMPACTION_RECOVERY_SOURCE_LABEL,
      description: "System-injected recovery instructions after context compaction.",
    });
  }

  if (sourceId === CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID) {
    return withRawContent(message, {
      title: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
      description:
        "Takode did not retry automatically because doing so could repeat actions. Expand to see what to check next.",
    });
  }

  if (sourceId === LEADER_KICKOFF_SOURCE_ID || (!sourceId && isLeaderKickoffPrompt(message.content))) {
    return withRawContent(message, {
      title: LEADER_KICKOFF_SOURCE_LABEL,
      description: "System-injected startup instructions for a leader session.",
    });
  }

  if (isLeaderSkillPreloadSourceId(sourceId)) {
    const firstLine = message.content.split(/\r?\n/, 1)[0]?.trim();
    return withRawContent(message, {
      title: firstLine?.startsWith(LEADER_SKILL_PRELOAD_SOURCE_LABEL_PREFIX)
        ? firstLine
        : "Required leader skill preloaded",
      description: "System-injected mandatory leader skill content.",
    });
  }

  if (isMemoryCatalogSourceId(sourceId)) {
    const hasWarning =
      isMemoryCatalogTruncationWarning(message.content) || isMemoryCatalogUnavailableWarning(message.content);
    return withRawContent(message, {
      title: MEMORY_CATALOG_TITLE || MEMORY_CATALOG_SOURCE_LABEL,
      description: hasWarning
        ? "System-injected memory catalog snapshot needs attention. When available, it is a `memory catalog show` snapshot from injection time; use `memory catalog diff` or direct file inspection for freshness."
        : "System-injected `memory catalog show` snapshot from injection time. Use `memory catalog diff` or direct file inspection for freshness before relying on memory facts.",
      ...(hasWarning ? { tone: "warning" as const } : {}),
    });
  }

  return null;
}

export function isInjectedEventMessage(message: EventCandidate): boolean {
  return buildInjectedEventMessageViewModel(message) !== null;
}
