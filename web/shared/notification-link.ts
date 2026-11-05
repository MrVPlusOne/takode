/**
 * Takode link syntax for needs-input notifications.
 *
 * Notification IDs (`n-3`) are only unique within the session that created them,
 * so the canonical href names both: `session:<sessionNum>:notification:<number>`.
 * The visible label stays human-readable, usually the notification summary.
 */
export interface NotificationLinkTarget {
  sessionNum: number;
  /** Raw stored notification ID, e.g. `n-3`. */
  notificationId: string;
}

const NOTIFICATION_LINK_PATTERN = /^session:(?:\/\/)?(\d+):notification:(?:n-)?(\d+)$/i;

export function parseNotificationLinkHref(href?: string): NotificationLinkTarget | null {
  const match = href?.trim().match(NOTIFICATION_LINK_PATTERN);
  if (!match) return null;
  return {
    sessionNum: Number.parseInt(match[1]!, 10),
    notificationId: `n-${Number.parseInt(match[2]!, 10)}`,
  };
}

/** Build a ready-to-paste Markdown link, e.g. `[Approve deploy?](session:12:notification:3)`. */
export function formatNotificationMarkdownLink(sessionNum: number, notificationId: string, label: string): string {
  const numericId = notificationId.replace(/^n-/i, "");
  const singleLine = label.replace(/\s+/g, " ").trim();
  const safeLabel = singleLine ? singleLine.replace(/[\\[\]]/g, "\\$&") : "question";
  return `[${safeLabel}](session:${sessionNum}:notification:${numericId})`;
}

const NEEDS_INPUT_CONTEXT_PREFIX = "needs-input-context-";

/** The id of the feed message that holds a needs-input prompt's decision context. */
export function needsInputContextMessageId(notificationId: string): string {
  return `${NEEDS_INPUT_CONTEXT_PREFIX}${notificationId}`;
}

/**
 * Whether a message is a needs-input prompt's context. It can reach a browser before its prompt,
 * so this tells it apart before the prompt is known.
 */
export function isNeedsInputContextMessageId(messageId: string): boolean {
  return messageId.startsWith(NEEDS_INPUT_CONTEXT_PREFIX);
}
