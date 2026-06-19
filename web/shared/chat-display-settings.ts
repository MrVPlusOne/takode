export const DEFAULT_CHAT_MESSAGE_LINE_HEIGHT = 1.45;
export const MIN_CHAT_MESSAGE_LINE_HEIGHT = 1.3;
export const MAX_CHAT_MESSAGE_LINE_HEIGHT = 1.7;
export const CHAT_MESSAGE_LINE_HEIGHT_STEP = 0.01;

export function isValidChatMessageLineHeight(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_CHAT_MESSAGE_LINE_HEIGHT &&
    value <= MAX_CHAT_MESSAGE_LINE_HEIGHT
  );
}

export function normalizeChatMessageLineHeight(value: unknown): number {
  if (!isValidChatMessageLineHeight(value)) return DEFAULT_CHAT_MESSAGE_LINE_HEIGHT;
  return Math.round(value * 100) / 100;
}
