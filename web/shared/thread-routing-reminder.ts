export const THREAD_ROUTING_REMINDER_SOURCE_ID = "system:thread-routing-reminder";
export const THREAD_ROUTING_REMINDER_SOURCE_LABEL = "Thread Routing Reminder";
export const THREAD_ROUTING_REMINDER_HEADER = "[Thread routing reminder]";

export type ThreadRoutingReminderReason = "missing" | "invalid";
export type ThreadRoutingReminderSource = "visible_text" | "shell_command";

export interface ThreadRoutingReminderInput {
  reason: ThreadRoutingReminderReason;
  source?: ThreadRoutingReminderSource;
  marker?: string;
}

export function formatThreadRoutingReminderReason(input: ThreadRoutingReminderInput): string {
  if (input.reason === "invalid") {
    return input.marker ? `Invalid marker: ${input.marker}` : "Invalid thread marker";
  }
  return "Missing thread marker";
}

export function buildThreadRoutingReminderContent(input: ThreadRoutingReminderInput): string {
  const reason = formatThreadRoutingReminderReason(input);
  if (input.source === "visible_text") {
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      `${reason} on visible leader text. The previous visible leader message was not assigned to a thread.`,
      "Resend user-visible leader text with `[thread:main]` or `[thread:q-N]` as the first line.",
      "For leader shell commands, use `# thread:main` or `# thread:q-N` as the first non-empty command line.",
    ].join("\n");
  }

  if (input.source === "shell_command") {
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      `${reason} on leader shell command. The previous leader shell command was not assigned to a thread.`,
      "Rerun leader shell commands with `# thread:main` or `# thread:q-N` as the first non-empty command line.",
      "For user-visible leader text, use `[thread:main]` or `[thread:q-N]` as the first line.",
    ].join("\n");
  }

  return [
    THREAD_ROUTING_REMINDER_HEADER,
    `${reason}. The previous leader output was not assigned to a thread, but the output type is unavailable.`,
    "If it was user-visible leader text, resend it with `[thread:main]` or `[thread:q-N]` as the first line.",
    "If it was a leader shell command, rerun it with `# thread:main` or `# thread:q-N` as the first non-empty command line.",
  ].join("\n");
}

export function isThreadRoutingReminderContent(content: string): boolean {
  return content.split(/\r?\n/, 1)[0]?.trim() === THREAD_ROUTING_REMINDER_HEADER;
}
