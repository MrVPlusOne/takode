export const QUEST_THREAD_REMINDER_SOURCE_ID = "system:quest-thread-reminder";
export const QUEST_THREAD_REMINDER_SOURCE_LABEL = "Quest Thread Reminder";
export const QUEST_THREAD_REMINDER_PREFIX = "Thread reminder:";

export function isQuestThreadReminderContent(content: string): boolean {
  return content.split(/\r?\n/, 1)[0]?.trim().startsWith(QUEST_THREAD_REMINDER_PREFIX) === true;
}

export function normalizeQuestThreadReminderContent(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
