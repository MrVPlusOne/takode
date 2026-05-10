import type { ChatMessage } from "../types.js";
import { NEEDS_INPUT_REMINDER_SOURCE_ID } from "./needs-input-reminder.js";
import { QUEST_THREAD_REMINDER_SOURCE_ID } from "../../shared/quest-thread-reminder.js";
import { THREAD_ROUTING_REMINDER_SOURCE_ID } from "../../shared/thread-routing-reminder.js";

export type SystemReminderKind = "resource-lease" | "long-sleep-guard" | "restart-continuation";

export interface SystemReminderViewModel {
  kind: SystemReminderKind;
  title: string;
  summary: string;
  badge: string;
  rawContent: string;
}

type ReminderCandidate = Pick<ChatMessage, "agentSource" | "content">;

export function isStandaloneReminderMessage(message: ReminderCandidate): boolean {
  const sourceId = message.agentSource?.sessionId;
  return (
    sourceId === QUEST_THREAD_REMINDER_SOURCE_ID ||
    sourceId === THREAD_ROUTING_REMINDER_SOURCE_ID ||
    sourceId === NEEDS_INPUT_REMINDER_SOURCE_ID ||
    sourceId?.startsWith("resource-lease:") === true ||
    sourceId === "system:long-sleep-guard" ||
    sourceId?.startsWith("system:restart-continuation:") === true
  );
}

export function buildSystemReminderViewModel(message: ReminderCandidate): SystemReminderViewModel | null {
  const sourceId = message.agentSource?.sessionId;
  if (sourceId?.startsWith("resource-lease:")) {
    return buildResourceLeaseReminder(message.content, sourceId);
  }
  if (sourceId === "system:long-sleep-guard") {
    return {
      kind: "long-sleep-guard",
      title: "Long sleep guard",
      summary: "Use takode timer instead of sleeps longer than 1 minute.",
      badge: "guard",
      rawContent: message.content,
    };
  }
  if (sourceId?.startsWith("system:restart-continuation:")) {
    return {
      kind: "restart-continuation",
      title: "Restart continuation",
      summary: "Server restart resumed this session.",
      badge: "system",
      rawContent: message.content,
    };
  }
  return null;
}

function buildResourceLeaseReminder(content: string, sourceId: string): SystemReminderViewModel {
  const resourceKey = sourceId.slice("resource-lease:".length) || parseBacktickValue(content) || "resource";
  const purpose = content.match(/^Purpose:\s*(.+)$/m)?.[1]?.trim();
  const expires = content.match(/^Expires:\s*(.+)$/m)?.[1]?.trim();
  const details = [resourceKey, purpose ? `purpose: ${purpose}` : "", expires ? `expires: ${expires}` : ""].filter(
    Boolean,
  );
  return {
    kind: "resource-lease",
    title: "Resource lease acquired",
    summary: details.join(" · "),
    badge: "lease",
    rawContent: content,
  };
}

function parseBacktickValue(content: string): string | null {
  return content.match(/`([^`]+)`/)?.[1]?.trim() || null;
}
