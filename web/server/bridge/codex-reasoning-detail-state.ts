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
): { message: CodexReasoningDetailMessage; changed: boolean; inserted: boolean } {
  const index = session.messageHistory.findIndex(
    (entry) => entry.type === "codex_reasoning_detail" && entry.id === incoming.id,
  );
  if (index < 0) {
    session.messageHistory.push(incoming);
    return { message: incoming, changed: true, inserted: true };
  }

  const existing = session.messageHistory[index] as CodexReasoningDetailMessage;
  const status = existing.status === "complete" || incoming.status === "complete" ? "complete" : "streaming";
  const text = mergeReasoningText(existing.text, incoming.text, incoming.status === "complete");
  const message: CodexReasoningDetailMessage = {
    ...existing,
    ...incoming,
    text,
    status,
    timestamp: existing.timestamp,
    ...(incoming.thinking_time_ms !== undefined
      ? { thinking_time_ms: incoming.thinking_time_ms }
      : existing.thinking_time_ms !== undefined
        ? { thinking_time_ms: existing.thinking_time_ms }
        : {}),
  };
  const changed =
    message.text !== existing.text ||
    message.status !== existing.status ||
    message.threadKey !== existing.threadKey ||
    message.questId !== existing.questId ||
    message.thinking_time_ms !== existing.thinking_time_ms;
  if (changed) session.messageHistory[index] = message;
  return { message: changed ? message : existing, changed, inserted: false };
}
