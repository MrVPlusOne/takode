import type { BrowserIncomingMessage, ContentBlock, ThreadRef, ThreadRoutingError } from "../session-types.js";
import {
  buildThreadRoutingReminderContent,
  THREAD_ROUTING_REMINDER_SOURCE_ID,
  THREAD_ROUTING_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-routing-reminder.js";
import {
  parseCommandThreadComment,
  parseThreadTextPrefix,
  stripCommandThreadComment,
} from "../../shared/thread-routing.js";
import {
  extractThreadStatusMarkersFromText,
  threadStatusKey,
  type LeaderThreadStatus,
  type ParsedThreadStatusMarker,
} from "../../shared/thread-status-marker.js";
import { routeFromHistoryEntry, threadRouteForTarget, type ThreadRouteMetadata } from "../thread-routing-metadata.js";
import { extractQuestThreadRemindersFromContent } from "./quest-thread-reminder.js";

const THREAD_ROUTING_EXPECTED =
  "Start with [thread:main] or [thread:q-N]. Bash commands must start with # thread:main or # thread:q-N.";

export interface LeaderAssistantRouteResult {
  content: ContentBlock[];
  threadKey?: string;
  questId?: string;
  threadRefs?: ThreadRef[];
  threadRoutingError?: ThreadRoutingError;
  questThreadReminders?: string[];
  threadStatusMarkers?: ParsedThreadStatusMarker[];
}

export interface ThreadRoutingReminderInjection {
  content: string;
  route: ThreadRouteMetadata;
  agentSource: {
    sessionId: typeof THREAD_ROUTING_REMINDER_SOURCE_ID;
    sessionLabel: typeof THREAD_ROUTING_REMINDER_SOURCE_LABEL;
  };
}

export interface ThreadRoutingReminderSessionLike {
  messageHistory: BrowserIncomingMessage[];
  userMessageIdsThisTurn?: number[];
}

export interface LeaderThreadStatusSessionLike {
  state: {
    leaderThreadStatuses?: Record<string, LeaderThreadStatus>;
  };
}

function threadRefForTarget(target: { threadKey: string; questId?: string }): ThreadRef | undefined {
  if (target.threadKey === "main") return undefined;
  return {
    threadKey: target.threadKey,
    ...(target.questId ? { questId: target.questId } : {}),
    source: "explicit",
    attachedAt: Date.now(),
  };
}

function mergeThreadRefs(
  existing: ThreadRef[] | undefined,
  markers: ParsedThreadStatusMarker[] | undefined,
): ThreadRef[] | undefined {
  const refs = new Map<string, ThreadRef>();
  for (const ref of existing ?? []) {
    refs.set(threadStatusKey(ref.threadKey), ref);
  }
  for (const marker of markers ?? []) {
    const ref = threadRefForTarget(marker.target);
    if (!ref) continue;
    refs.set(threadStatusKey(ref.threadKey), ref);
  }
  return refs.size > 0 ? [...refs.values()] : undefined;
}

export function extractLeaderThreadStatusMarkersFromContent(content: ContentBlock[]): {
  content: ContentBlock[];
  markers: ParsedThreadStatusMarker[];
} {
  const markers: ParsedThreadStatusMarker[] = [];
  const nextContent: ContentBlock[] = [];

  for (const block of content) {
    if (block.type !== "text") {
      nextContent.push(block);
      continue;
    }
    const extracted = extractThreadStatusMarkersFromText(block.text);
    markers.push(...extracted.markers);
    if (extracted.text.trim()) {
      nextContent.push({ ...block, text: extracted.text });
    }
  }

  return { content: nextContent, markers };
}

function threadRoutingErrorForText(
  parsed: Extract<ReturnType<typeof parseThreadTextPrefix>, { ok: false }>,
  content: ContentBlock[],
): ThreadRoutingError {
  return {
    reason: parsed.reason,
    expected: THREAD_ROUTING_EXPECTED,
    rawContent: content.map((block) => (block.type === "text" ? block.text : "")).join("\n"),
    ...(parsed.marker ? { marker: parsed.marker } : {}),
  };
}

function threadRoutingErrorForCommand(command: string): ThreadRoutingError {
  return {
    reason: "missing",
    expected: THREAD_ROUTING_EXPECTED,
    rawContent: command,
  };
}

export function normalizeLeaderAssistantRouting(
  isLeaderSession: boolean,
  content: ContentBlock[],
  parentToolUseId: string | null | undefined,
): LeaderAssistantRouteResult {
  if (!isLeaderSession || parentToolUseId) return { content };

  const extracted = extractQuestThreadRemindersFromContent(content);
  const statusExtracted = extractLeaderThreadStatusMarkersFromContent(extracted.content);
  const questThreadReminders = extracted.reminders.length > 0 ? { questThreadReminders: extracted.reminders } : {};
  const threadStatusMarkers =
    statusExtracted.markers.length > 0 ? { threadStatusMarkers: statusExtracted.markers } : {};
  const nextContent = statusExtracted.content.map((block) =>
    block.type === "tool_use" && block.name === "Bash" && typeof block.input?.command === "string"
      ? {
          ...block,
          input: {
            ...block.input,
            command: stripCommandThreadComment(String(block.input.command)),
          },
        }
      : block,
  );

  const firstTextIndex = nextContent.findIndex((block) => block.type === "text" && block.text.trim());
  if (firstTextIndex >= 0) {
    const firstText = nextContent[firstTextIndex] as Extract<ContentBlock, { type: "text" }>;
    const parsed = parseThreadTextPrefix(firstText.text);
    if (!parsed.ok) {
      const refs = mergeThreadRefs(undefined, statusExtracted.markers);
      return {
        content: nextContent,
        ...(refs ? { threadRefs: refs } : {}),
        threadRoutingError: threadRoutingErrorForText(parsed, content),
        ...questThreadReminders,
        ...threadStatusMarkers,
      };
    }
    const routed = nextContent.slice();
    routed[firstTextIndex] = { ...firstText, text: parsed.body };
    const ref = threadRefForTarget(parsed.target);
    const refs = mergeThreadRefs(ref ? [ref] : undefined, statusExtracted.markers);
    return {
      content: routed,
      threadKey: parsed.target.threadKey,
      ...(parsed.target.questId ? { questId: parsed.target.questId } : {}),
      ...(refs ? { threadRefs: refs } : {}),
      ...questThreadReminders,
      ...threadStatusMarkers,
    };
  }

  const bashBlocks = statusExtracted.content.filter(
    (block): block is Extract<ContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === "Bash" && typeof block.input?.command === "string",
  );
  if (bashBlocks.length > 0) {
    const target = parseCommandThreadComment(String(bashBlocks[0].input.command));
    if (!target) {
      return {
        content: nextContent,
        threadRoutingError: threadRoutingErrorForCommand(String(bashBlocks[0].input.command)),
        ...questThreadReminders,
        ...threadStatusMarkers,
      };
    }
    const ref = threadRefForTarget(target);
    const refs = mergeThreadRefs(ref ? [ref] : undefined, statusExtracted.markers);
    return {
      content: nextContent,
      threadKey: target.threadKey,
      ...(target.questId ? { questId: target.questId } : {}),
      ...(refs ? { threadRefs: refs } : {}),
      ...questThreadReminders,
      ...threadStatusMarkers,
    };
  }

  const refs = mergeThreadRefs(undefined, statusExtracted.markers);
  return {
    content: nextContent,
    ...(refs ? { threadRefs: refs } : {}),
    ...questThreadReminders,
    ...threadStatusMarkers,
  };
}

export function recordLeaderThreadStatusMarkers(
  session: LeaderThreadStatusSessionLike,
  markers: ParsedThreadStatusMarker[] | undefined,
  anchor: { messageId: string; timestamp: number },
): LeaderThreadStatus[] {
  if (!markers?.length) return [];

  const statuses = { ...(session.state.leaderThreadStatuses ?? {}) };
  const records: LeaderThreadStatus[] = [];
  for (const marker of markers) {
    const key = threadStatusKey(marker.target.threadKey);
    const record: LeaderThreadStatus = {
      kind: marker.kind,
      label: marker.label,
      threadKey: marker.target.threadKey,
      ...(marker.target.questId ? { questId: marker.target.questId } : {}),
      summary: marker.summary,
      messageId: anchor.messageId,
      timestamp: anchor.timestamp,
      updatedAt: Date.now(),
    };
    statuses[key] = record;
    records.push(record);
  }
  session.state.leaderThreadStatuses = statuses;
  return records;
}

export function clearLeaderThreadStatusesForGenerationStart(session: LeaderThreadStatusSessionLike): boolean {
  const existing = session.state.leaderThreadStatuses;
  if (!existing || Object.keys(existing).length === 0) return false;
  session.state.leaderThreadStatuses = {};
  return true;
}

function findTriggeringTurnRoute(session: ThreadRoutingReminderSessionLike): ThreadRouteMetadata {
  const ids = session.userMessageIdsThisTurn ?? [];
  for (let index = ids.length - 1; index >= 0; index--) {
    const entry = session.messageHistory[ids[index]!] as BrowserIncomingMessage | undefined;
    const route = routeFromHistoryEntry(entry);
    if (route) return route;
  }
  return threadRouteForTarget("main");
}

function wasTriggeredByThreadRoutingReminder(session: ThreadRoutingReminderSessionLike): boolean {
  for (const historyIndex of session.userMessageIdsThisTurn ?? []) {
    const entry = session.messageHistory[historyIndex] as BrowserIncomingMessage | undefined;
    if (entry?.type !== "user_message") continue;
    if (entry.agentSource?.sessionId === THREAD_ROUTING_REMINDER_SOURCE_ID) return true;
  }
  return false;
}

function firstCurrentTurnHistoryIndex(session: ThreadRoutingReminderSessionLike): number {
  const ids = session.userMessageIdsThisTurn ?? [];
  if (ids.length === 0) return Math.max(0, session.messageHistory.length - 1);
  return Math.max(0, Math.min(...ids));
}

function findThreadRoutingErrorForCurrentTurn(session: ThreadRoutingReminderSessionLike): ThreadRoutingError | null {
  const startIndex = firstCurrentTurnHistoryIndex(session);
  for (let index = session.messageHistory.length - 1; index >= startIndex; index--) {
    const entry = session.messageHistory[index];
    if (!entry) continue;
    if (entry.type === "result") continue;
    if (entry.type === "assistant" && entry.threadRoutingError) return entry.threadRoutingError;
  }
  return null;
}

export function buildThreadRoutingReminderForCompletedTurn(
  session: ThreadRoutingReminderSessionLike,
): ThreadRoutingReminderInjection | null {
  if (wasTriggeredByThreadRoutingReminder(session)) return null;
  const error = findThreadRoutingErrorForCurrentTurn(session);
  if (!error) return null;
  return {
    content: buildThreadRoutingReminderContent({
      reason: error.reason,
      ...(error.marker ? { marker: error.marker } : {}),
    }),
    route: findTriggeringTurnRoute(session),
    agentSource: {
      sessionId: THREAD_ROUTING_REMINDER_SOURCE_ID,
      sessionLabel: THREAD_ROUTING_REMINDER_SOURCE_LABEL,
    },
  };
}
