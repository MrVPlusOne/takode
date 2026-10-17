import type { ChatMessage } from "../types.js";
import { NEEDS_INPUT_RESOLUTION_NOTICE_SOURCE_ID } from "./needs-input-resolution-notice.js";
import { NEEDS_INPUT_REMINDER_SOURCE_ID } from "./needs-input-reminder.js";
import { QUEST_THREAD_REMINDER_SOURCE_ID } from "../../shared/quest-thread-reminder.js";
import { THREAD_ROUTING_REMINDER_SOURCE_ID } from "../../shared/thread-routing-reminder.js";
import {
  parseResourceLeaseMessageFields,
  stripResourceLeaseMessageFields,
} from "../../shared/resource-lease-message.js";
import { LANDING_QUEUE_MESSAGE_SOURCE, LANDING_QUEUE_MESSAGE_TAG } from "../../shared/landing-queue.js";
import { SESSION_RECOVERY_SOURCE_ID, SKILL_CHANGE_NOTICE_SOURCE_ID } from "../../shared/injected-event-message.js";

export type SystemReminderKind =
  | "resource-lease"
  | "long-sleep-guard"
  | "restart-continuation"
  | "landing-queue"
  | "session-recovery"
  | "skills-changed";

/** Color of a chip: good news, something that needs a look, or neutral system info. */
export type SystemReminderTone = "success" | "attention" | "info";

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
  tone: SystemReminderTone;
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
    sourceId?.startsWith("system:restart-continuation:") === true ||
    sourceId === LANDING_QUEUE_MESSAGE_SOURCE.sessionId ||
    sourceId === SESSION_RECOVERY_SOURCE_ID ||
    sourceId === SKILL_CHANGE_NOTICE_SOURCE_ID
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
      tone: "attention",
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
      tone: "info",
      detailFacts: [],
      detailContent: message.content,
    };
  }
  if (sourceId === LANDING_QUEUE_MESSAGE_SOURCE.sessionId) return buildLandingQueueReminder(message.content);
  if (sourceId === SESSION_RECOVERY_SOURCE_ID) return buildSessionRecoveryReminder(message.content);
  if (sourceId === SKILL_CHANGE_NOTICE_SOURCE_ID) return buildSkillChangeReminder(message.content);
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
    tone: "success",
    detailFacts,
    detailContent: stripResourceLeaseMessageFields(content),
  };
}

/**
 * Landing-queue messages tell a worker or leader that a change landed, bounced
 * or could not be recorded. The chip keeps the first sentence ("q-12 landed on
 * main") and an outcome badge; SHAs, commands and bounce logs stay in the detail.
 */
function buildLandingQueueReminder(content: string): SystemReminderViewModel {
  const body = content.startsWith(LANDING_QUEUE_MESSAGE_TAG)
    ? content.slice(LANDING_QUEUE_MESSAGE_TAG.length).trimStart()
    : content;
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  // A first sentence ends at ". " so dotted branch names and paths stay whole.
  // Parenthetical run, log and SHA details would push the outcome off a phone screen.
  const sentenceEnd = firstLine.indexOf(". ");
  const summary = (sentenceEnd >= 0 ? firstLine.slice(0, sentenceEnd) : firstLine)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\.$/, "");
  const outcome = landingOutcome(firstLine);
  return {
    kind: "landing-queue",
    title: "Landing queue",
    summary,
    badge: outcome,
    tone: outcome === "landed" ? "success" : outcome === "notice" ? "info" : "attention",
    detailFacts: [],
    detailContent: body,
  };
}

function landingOutcome(firstLine: string): "landed" | "bounced" | "withdrawn" | "problem" | "notice" {
  if (/\bcould not\b/.test(firstLine)) return "problem";
  if (/\bbounced\b/.test(firstLine)) return "bounced";
  if (/\bwas withdrawn\b/.test(firstLine)) return "withdrawn";
  if (/\blanded on\b/.test(firstLine)) return "landed";
  return "notice";
}

/** The notice lists what Takode rebuilt as "- Worktree:" and "- Conversation:" lines. */
function buildSessionRecoveryReminder(content: string): SystemReminderViewModel {
  const rebuilt = [
    /^- Worktree:/m.test(content) ? "new worktree" : null,
    /^- Conversation:/m.test(content) ? "conversation lost" : null,
  ].filter((part): part is string => part !== null);
  return {
    kind: "session-recovery",
    title: "Session rebuilt",
    summary: rebuilt.length > 0 ? rebuilt.join(", ") : "Takode rebuilt part of this session",
    badge: "system",
    tone: "attention",
    detailFacts: [],
    detailContent: content,
  };
}

/** The notice's first line names the changed skills in backticks. */
function buildSkillChangeReminder(content: string): SystemReminderViewModel {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const names = [...firstLine.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  return {
    kind: "skills-changed",
    title: "Skills changed",
    summary: names.length > 0 ? names.join(", ") : firstLine,
    badge: "skills",
    tone: "info",
    detailFacts: [],
    detailContent: content,
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
