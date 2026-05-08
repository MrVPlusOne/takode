import type { ChatMessage } from "../types.js";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";

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
    title: THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
    rawContent: message.content,
  };
}
