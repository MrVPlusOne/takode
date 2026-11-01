/** A handoff's result as the server reports it. */
export interface ThreadHandoffResult {
  ok?: boolean;
  sessionId?: string;
  questId: string;
  /** Set when the quest isn't on the board yet: the handoff happens when `takode board set` puts it there. */
  pending?: boolean;
  userMessageIds?: string[];
  handedOffUserMessageIds?: string[];
  alreadyHandedOffUserMessageIds?: string[];
  notificationIds?: string[];
  alreadyHandedOffNotificationIds?: string[];
  /** The side chat that became the quest's thread with this handoff. */
  chatBecameQuestThread?: string;
  error?: string;
}

/** One line saying what a handoff did, or what it will do once the quest is on the board. */
export function formatHandoffResult(result: ThreadHandoffResult): string {
  if (result.error) return `Not handed off to ${result.questId}: ${result.error}`;
  if (result.pending) {
    return `${(result.userMessageIds ?? []).join(", ")} will be handed off to ${result.questId} when \`takode board set\` puts it on your board.`;
  }
  const changed = formatIds(result.handedOffUserMessageIds ?? [], result.notificationIds ?? []);
  const unchanged = formatIds(
    result.alreadyHandedOffUserMessageIds ?? [],
    result.alreadyHandedOffNotificationIds ?? [],
  );
  const summary = changed ? `Handed off to ${result.questId}: ${changed}.` : `No changes for ${result.questId}.`;
  const chat = result.chatBecameQuestThread
    ? ` The side chat ${result.chatBecameQuestThread} is now ${result.questId}'s thread: answer in ${result.questId}.`
    : "";
  return `${summary}${unchanged ? ` Already handed off: ${unchanged}.` : ""}${chat}`;
}

function formatIds(userMessageIds: string[], notificationIds: string[]): string {
  return [userMessageIds.join(", "), notificationIds.length > 0 ? `notifications ${notificationIds.join(", ")}` : ""]
    .filter(Boolean)
    .join("; ");
}
