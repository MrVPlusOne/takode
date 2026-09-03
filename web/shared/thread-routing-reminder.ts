export const THREAD_ROUTING_REMINDER_SOURCE_ID = "system:thread-routing-reminder";
export const THREAD_ROUTING_REMINDER_SOURCE_LABEL = "Thread Routing Reminder";
export const THREAD_ROUTING_REMINDER_HEADER = "[Thread routing reminder]";

export type ThreadRoutingReminderReason = "missing" | "invalid" | "missing_role" | "invalid_role";
export type ThreadRoutingReminderSource = "visible_text" | "shell_command";

export interface ThreadRoutingReminderInput {
  reason: ThreadRoutingReminderReason;
  source?: ThreadRoutingReminderSource;
  marker?: string;
}

export function formatThreadRoutingReminderReason(input: ThreadRoutingReminderInput): string {
  if (input.reason === "missing_role") return "Missing commentary/final-response role";
  if (input.reason === "invalid_role") {
    return input.marker
      ? `Invalid commentary/final-response role: ${input.marker}`
      : "Invalid commentary/final-response role";
  }
  if (input.reason === "invalid") {
    return input.marker ? `Invalid marker: ${input.marker}` : "Invalid thread marker";
  }
  return "Missing thread marker";
}

export function buildThreadRoutingReminderContent(input: ThreadRoutingReminderInput): string {
  const reason = formatThreadRoutingReminderReason(input);
  if (input.source === "visible_text") {
    if (input.reason === "missing_role" || input.reason === "invalid_role") {
      return [
        THREAD_ROUTING_REMINDER_HEADER,
        `${reason} on visible leader text. The text may remain routed for audit, but it cannot satisfy a pending user-response batch.`,
        "Use `[thread:main:C]` or `[thread:q-N:C]` for commentary and `[thread:main:F]` or `[thread:q-N:F]` for a self-contained final response.",
        "When one leader output intentionally needs multiple thread tabs, keep the first compact marker for the first segment, then put a standalone `---` line immediately before each later role-bearing marker.",
        "Leader shell commands remain commentary and use `# thread:main` or `# thread:q-N` as the first non-empty command line.",
      ].join("\n");
    }
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      `${reason} on visible leader text. The previous visible leader message was not assigned to a thread.`,
      "Resend visible leader text with `[thread:main:C]` / `[thread:q-N:C]` for commentary or `[thread:main:F]` / `[thread:q-N:F]` for a final response.",
      "When one leader response intentionally needs multiple thread tabs, keep the first role-bearing marker for the first tab, then put a standalone `---` line immediately before the next role-bearing marker.",
      "For leader shell commands, use `# thread:main` or `# thread:q-N` as the first non-empty command line.",
    ].join("\n");
  }

  if (input.source === "shell_command") {
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      `${reason} on leader shell command. The previous leader shell command was not assigned to a thread.`,
      "Rerun leader shell commands with `# thread:main` or `# thread:q-N` as the first non-empty command line.",
      "For visible leader text, use `[thread:main:C]` / `[thread:q-N:C]` for commentary or `[thread:main:F]` / `[thread:q-N:F]` for a final response.",
      "If one visible leader response intentionally covers multiple thread tabs, put a standalone `---` line immediately before each later role-bearing marker.",
    ].join("\n");
  }

  return [
    THREAD_ROUTING_REMINDER_HEADER,
    `${reason}. The previous leader output was not assigned to a thread, but the output type is unavailable.`,
    "If it was visible leader text, resend it with `[thread:main:C]` / `[thread:q-N:C]` for commentary or `[thread:main:F]` / `[thread:q-N:F]` for a final response.",
    "If one visible leader response intentionally covers multiple thread tabs, use a standalone `---` line immediately before each later role-bearing marker.",
    "If it was a leader shell command, rerun it with `# thread:main` or `# thread:q-N` as the first non-empty command line.",
  ].join("\n");
}

export function isThreadRoutingReminderContent(content: string): boolean {
  return content.split(/\r?\n/, 1)[0]?.trim() === THREAD_ROUTING_REMINDER_HEADER;
}
