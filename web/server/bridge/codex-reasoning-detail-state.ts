import type { BrowserIncomingMessage, CodexReasoningDetailMessage } from "../session-types.js";

export interface CodexReasoningDetailSession {
  messageHistory: BrowserIncomingMessage[];
}

function mergeReasoningText(existing: string, incoming: string, incomingComplete: boolean): string {
  if (incoming === existing) return existing;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  return incomingComplete ? incoming : existing;
}

export function upsertCodexReasoningDetail(
  session: CodexReasoningDetailSession,
  incoming: CodexReasoningDetailMessage,
): { message: CodexReasoningDetailMessage; changed: boolean; activityChanged: boolean; inserted: boolean } {
  const index = session.messageHistory.findIndex((entry) => {
    if (entry.type !== "codex_reasoning_detail") return false;
    if (entry.id === incoming.id) return true;
    if (incoming.provider_item_id && entry.provider_item_id === incoming.provider_item_id) {
      return entry.summary_index === incoming.summary_index;
    }
    return (
      incoming.reasoning_turn_id !== undefined &&
      incoming.reasoning_item_ordinal !== undefined &&
      incoming.summary_index !== undefined &&
      entry.reasoning_turn_id === incoming.reasoning_turn_id &&
      entry.reasoning_item_ordinal === incoming.reasoning_item_ordinal &&
      entry.summary_index === incoming.summary_index
    );
  });
  if (index < 0) {
    session.messageHistory.push(incoming);
    return { message: incoming, changed: true, activityChanged: true, inserted: true };
  }

  const existing = session.messageHistory[index] as CodexReasoningDetailMessage;
  const status = existing.status === "complete" || incoming.status === "complete" ? "complete" : "streaming";
  const text = mergeReasoningText(existing.text, incoming.text, incoming.status === "complete");
  const message: CodexReasoningDetailMessage = {
    ...existing,
    ...incoming,
    id: existing.id,
    reasoning_turn_id: existing.reasoning_turn_id ?? incoming.reasoning_turn_id,
    reasoning_item_ordinal: existing.reasoning_item_ordinal ?? incoming.reasoning_item_ordinal,
    summary_index: existing.summary_index ?? incoming.summary_index,
    text,
    status,
    timestamp: existing.timestamp,
    ...(incoming.thinking_time_ms !== undefined
      ? { thinking_time_ms: incoming.thinking_time_ms }
      : existing.thinking_time_ms !== undefined
        ? { thinking_time_ms: existing.thinking_time_ms }
        : {}),
  };
  const activityChanged =
    message.text !== existing.text ||
    message.status !== existing.status ||
    message.thinking_time_ms !== existing.thinking_time_ms;
  const changed =
    activityChanged ||
    message.threadKey !== existing.threadKey ||
    message.questId !== existing.questId ||
    message.reasoning_turn_id !== existing.reasoning_turn_id ||
    message.reasoning_item_ordinal !== existing.reasoning_item_ordinal ||
    message.provider_item_id !== existing.provider_item_id ||
    message.summary_index !== existing.summary_index;
  if (changed) session.messageHistory[index] = message;
  return { message: changed ? message : existing, changed, activityChanged, inserted: false };
}
