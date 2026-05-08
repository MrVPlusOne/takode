import type { ChatMessage } from "../types.js";

export const THREAD_OUTCOME_REMINDER_SOURCE_ID = "system:leader-thread-outcome-reminder";
export const THREAD_OUTCOME_REMINDER_TITLE = "Thread Outcome Reminder";

export interface ThreadOutcomeReminderViewModel {
  title: string;
  rawContent: string;
}

export function buildThreadOutcomeReminderViewModel(
  message: Pick<ChatMessage, "agentSource" | "content">,
): ThreadOutcomeReminderViewModel | null {
  if (message.agentSource?.sessionId !== THREAD_OUTCOME_REMINDER_SOURCE_ID) return null;
  if (!message.content.trim()) return null;
  return {
    title: THREAD_OUTCOME_REMINDER_TITLE,
    rawContent: message.content,
  };
}
