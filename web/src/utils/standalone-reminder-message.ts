import type { ChatMessage } from "../types.js";
import { NEEDS_INPUT_RESOLUTION_NOTICE_SOURCE_ID } from "./needs-input-resolution-notice.js";
import { NEEDS_INPUT_REMINDER_SOURCE_ID } from "./needs-input-reminder.js";
import { QUEST_THREAD_REMINDER_SOURCE_ID } from "../../shared/quest-thread-reminder.js";
import { THREAD_ROUTING_REMINDER_SOURCE_ID } from "../../shared/thread-routing-reminder.js";
import {
  parseResourceLeaseMessageFields,
  stripResourceLeaseMessageFields,
} from "../../shared/resource-lease-message.js";

export type SystemReminderKind = "resource-lease" | "long-sleep-guard" | "restart-continuation";

export interface SystemReminderDetailFact {
  label: string;
  value: string;
}

export interface SystemReminderViewModel {
  kind: SystemReminderKind;
  title: string;
  summary: string;
  /** Short text kept visible beside the badge while the summary truncates. */
  meta?: string;
  badge: string;
  /** Labeled facts shown above the detail text when the chip is expanded. */
  detailFacts: SystemReminderDetailFact[];
  /** Markdown shown when the chip is expanded. */
  detailContent: string;
}

type ReminderCandidate = Pick<ChatMessage, "agentSource" | "content"> & Partial<Pick<ChatMessage, "timestamp">>;

export function isStandaloneReminderMessage(message: ReminderCandidate): boolean {
  const sourceId = message.agentSource?.sessionId;
  return (
    sourceId === QUEST_THREAD_REMINDER_SOURCE_ID ||
    sourceId === THREAD_ROUTING_REMINDER_SOURCE_ID ||
    sourceId === NEEDS_INPUT_REMINDER_SOURCE_ID ||
    sourceId === NEEDS_INPUT_RESOLUTION_NOTICE_SOURCE_ID ||
    sourceId?.startsWith("resource-lease:") === true ||
    sourceId === "system:long-sleep-guard" ||
    sourceId?.startsWith("system:restart-continuation:") === true
  );
}

export function buildSystemReminderViewModel(message: ReminderCandidate): SystemReminderViewModel | null {
  const sourceId = message.agentSource?.sessionId;
  if (sourceId?.startsWith("resource-lease:")) {
    return buildResourceLeaseReminder(message, sourceId);
  }
  if (sourceId === "system:long-sleep-guard") {
    return {
      kind: "long-sleep-guard",
      title: "Long sleep guard",
      summary: "Use takode timer instead of sleeps longer than 1 minute.",
      badge: "guard",
      detailFacts: [],
      detailContent: message.content,
    };
  }
  if (sourceId?.startsWith("system:restart-continuation:")) {
    return {
      kind: "restart-continuation",
      title: "Restart continuation",
      summary: "Server restart resumed this session.",
      badge: "system",
      detailFacts: [],
      detailContent: message.content,
    };
  }
  return null;
}

function buildResourceLeaseReminder(message: ReminderCandidate, sourceId: string): SystemReminderViewModel {
  const { content } = message;
  const resourceKey = sourceId.slice("resource-lease:".length) || parseBacktickValue(content) || "resource";
  const fields = parseResourceLeaseMessageFields(content);
  // Messages from older servers lack the Acquired line; the injected message's
  // own timestamp is when the lease was granted.
  const acquired = formatExactTime(fields.acquired) ?? formatExactTime(message.timestamp);
  const detailFacts = [
    acquired ? { label: "Acquired", value: acquired } : null,
    fields.waited ? { label: "Waited", value: fields.waited } : null,
    fields.slot ? { label: "Slot", value: fields.slot } : null,
    fields.purpose ? { label: "Purpose", value: fields.purpose } : null,
    fields.expires ? { label: "Expires", value: formatExactTime(fields.expires) ?? fields.expires } : null,
  ].filter((fact): fact is SystemReminderDetailFact => fact !== null);
  return {
    kind: "resource-lease",
    title: "Resource lease acquired",
    summary: resourceKey,
    ...(fields.waited ? { meta: `waited ${fields.waited}` } : {}),
    badge: "lease",
    detailFacts,
    detailContent: stripResourceLeaseMessageFields(content),
  };
}

function formatExactTime(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseBacktickValue(content: string): string | null {
  return content.match(/`([^`]+)`/)?.[1]?.trim() || null;
}
