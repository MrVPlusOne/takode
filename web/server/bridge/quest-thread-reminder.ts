import type { BrowserIncomingMessage, ContentBlock } from "../session-types.js";
import type { ThreadRouteMetadata } from "../thread-routing-metadata.js";
import { routeFromHistoryEntry, threadRouteForTarget } from "../thread-routing-metadata.js";
import {
  normalizeQuestThreadReminderContent,
  QUEST_THREAD_REMINDER_PREFIX,
  QUEST_THREAD_REMINDER_SOURCE_ID,
  QUEST_THREAD_REMINDER_SOURCE_LABEL,
} from "../../shared/quest-thread-reminder.js";

export interface QuestThreadReminderInjection {
  content: string;
  route?: ThreadRouteMetadata;
  agentSource: {
    sessionId: typeof QUEST_THREAD_REMINDER_SOURCE_ID;
    sessionLabel: typeof QUEST_THREAD_REMINDER_SOURCE_LABEL;
  };
}

export type QuestThreadReminderDelivery = Omit<QuestThreadReminderInjection, "route"> & {
  route: ThreadRouteMetadata;
};

export interface QuestThreadReminderSessionLike {
  messageHistory: BrowserIncomingMessage[];
  userMessageIdsThisTurn?: number[];
  questThreadRemindersThisTurn?: QuestThreadReminderInjection[];
}

export function extractQuestThreadRemindersFromContent(content: ContentBlock[]): {
  content: ContentBlock[];
  reminders: string[];
} {
  const reminders: string[] = [];
  const nextContent: ContentBlock[] = [];

  for (const block of content) {
    if (block.type !== "text") {
      nextContent.push(block);
      continue;
    }

    const extracted = extractQuestThreadRemindersFromText(block.text);
    reminders.push(...extracted.reminders);
    if (extracted.text.trim()) {
      nextContent.push({ ...block, text: extracted.text });
    }
  }

  return { content: nextContent, reminders: dedupeReminders(reminders) };
}

export function queueQuestThreadRemindersForCompletedTurn(
  session: QuestThreadReminderSessionLike,
  reminders: string[],
  route?: ThreadRouteMetadata,
): void {
  if (reminders.length === 0 || wasTriggeredByQuestThreadReminder(session)) return;

  const queued = (session.questThreadRemindersThisTurn ??= []);
  const existingKeys = new Set(queued.map((reminder) => questThreadReminderKey(reminder.content, reminder.route)));
  for (const reminder of reminders) {
    const content = normalizeQuestThreadReminderContent(reminder);
    const key = questThreadReminderKey(content, route);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    queued.push({
      content,
      ...(route ? { route } : {}),
      agentSource: {
        sessionId: QUEST_THREAD_REMINDER_SOURCE_ID,
        sessionLabel: QUEST_THREAD_REMINDER_SOURCE_LABEL,
      },
    });
  }
}

export function consumeQuestThreadRemindersForCompletedTurn(
  session: QuestThreadReminderSessionLike,
): QuestThreadReminderDelivery[] {
  const queued = session.questThreadRemindersThisTurn ?? [];
  session.questThreadRemindersThisTurn = [];
  if (queued.length === 0 || wasTriggeredByQuestThreadReminder(session)) return [];

  const fallbackRoute = findTriggeringTurnRoute(session);
  return queued.map((reminder) => ({
    ...reminder,
    route: reminder.route ?? fallbackRoute,
  }));
}

function extractQuestThreadRemindersFromText(text: string): { text: string; reminders: string[] } {
  const reminders: string[] = [];
  const keptLines: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(QUEST_THREAD_REMINDER_PREFIX)) {
      reminders.push(trimmed);
      continue;
    }
    keptLines.push(line);
  }

  return {
    text: keptLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd(),
    reminders,
  };
}

function dedupeReminders(reminders: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const reminder of reminders) {
    const normalized = normalizeQuestThreadReminderContent(reminder);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function questThreadReminderKey(content: string, route: ThreadRouteMetadata | undefined): string {
  return JSON.stringify({ content, route: routeKey(route) });
}

function routeKey(route: ThreadRouteMetadata | undefined): Pick<ThreadRouteMetadata, "threadKey" | "questId"> | null {
  if (!route) return null;
  return {
    threadKey: route.threadKey,
    ...(route.questId ? { questId: route.questId } : {}),
  };
}

function findTriggeringTurnRoute(session: QuestThreadReminderSessionLike): ThreadRouteMetadata {
  const ids = session.userMessageIdsThisTurn ?? [];
  for (let index = ids.length - 1; index >= 0; index--) {
    const entry = session.messageHistory[ids[index]!] as BrowserIncomingMessage | undefined;
    const route = routeFromHistoryEntry(entry);
    if (route) return route;
  }
  return threadRouteForTarget("main");
}

function wasTriggeredByQuestThreadReminder(session: QuestThreadReminderSessionLike): boolean {
  for (const historyIndex of session.userMessageIdsThisTurn ?? []) {
    const entry = session.messageHistory[historyIndex] as BrowserIncomingMessage | undefined;
    if (entry?.type !== "user_message") continue;
    if (entry.agentSource?.sessionId === QUEST_THREAD_REMINDER_SOURCE_ID) return true;
  }
  return false;
}
