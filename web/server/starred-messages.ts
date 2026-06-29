import type { BrowserIncomingMessage, StarredMessageRecord } from "./session-types.js";
import { MAIN_THREAD_KEY, normalizeSelectedFeedThreadKey } from "../shared/thread-window.js";

export type StableStarTarget = Omit<StarredMessageRecord, "starredAt">;

export function findStableStarTarget(
  messageHistory: ReadonlyArray<BrowserIncomingMessage>,
  messageId: string,
  historyIndex?: number,
): StableStarTarget | null {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) return null;

  if (typeof historyIndex === "number" && Number.isInteger(historyIndex) && historyIndex >= 0) {
    const target = stableStarTargetForMessage(messageHistory[historyIndex], historyIndex);
    if (target?.messageId === normalizedMessageId) return target;
  }

  for (let index = 0; index < messageHistory.length; index++) {
    const target = stableStarTargetForMessage(messageHistory[index], index);
    if (target?.messageId === normalizedMessageId) return target;
  }
  return null;
}

export function stableStarTargetForMessage(
  message: BrowserIncomingMessage | undefined,
  historyIndex: number,
): StableStarTarget | null {
  if (!message) return null;
  if (message.type === "user_message") {
    if (!hasStableStringId(message.id)) return null;
    return {
      ...threadMetadataForStarredMessage(message),
      messageId: message.id,
      role: "user",
      historyIndex,
      timestamp: timestampForStarredMessage(message),
    };
  }
  if (message.type === "leader_user_message") {
    if (!hasStableStringId(message.id)) return null;
    return {
      ...threadMetadataForStarredMessage(message),
      messageId: message.id,
      role: "assistant",
      historyIndex,
      timestamp: timestampForStarredMessage(message),
    };
  }
  if (message.type === "assistant") {
    const stableId = message.message.id;
    if (!hasStableStringId(stableId)) return null;
    if (!assistantMessageHasStarredBubbleContent(message.message.content)) return null;
    return {
      ...threadMetadataForStarredMessage(message),
      messageId: stableId,
      role: "assistant",
      historyIndex,
      timestamp: timestampForStarredMessage(message),
    };
  }
  return null;
}

function hasStableStringId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assistantMessageHasStarredBubbleContent(
  messageContent: Extract<BrowserIncomingMessage, { type: "assistant" }>["message"]["content"],
): boolean {
  return messageContent.some((block) => {
    if (block.type === "text") return block.text.trim().length > 0;
    if (block.type === "thinking") return block.thinking.trim().length > 0;
    return false;
  });
}

function timestampForStarredMessage(message: BrowserIncomingMessage): number {
  return "timestamp" in message && typeof message.timestamp === "number" ? message.timestamp : 0;
}

function threadMetadataForStarredMessage(message: BrowserIncomingMessage): {
  sourceThreadKey: string;
  routeThreadKey: string;
  questId?: string;
} {
  const explicitThreadKey = normalizeOptionalThreadKey((message as { threadKey?: string }).threadKey);
  const questThreadKey = normalizeOptionalThreadKey((message as { questId?: string }).questId);
  const threadRef = (message as { threadRefs?: Array<{ threadKey: string; questId?: string }> }).threadRefs?.find(
    (ref) => normalizeSelectedFeedThreadKey(ref.threadKey) !== MAIN_THREAD_KEY,
  );
  const refThreadKey = normalizeOptionalThreadKey(threadRef?.threadKey);
  const sourceThreadKey = explicitThreadKey ?? questThreadKey ?? refThreadKey ?? MAIN_THREAD_KEY;
  const questId =
    (message as { questId?: string }).questId ??
    (sourceThreadKey !== MAIN_THREAD_KEY ? sourceThreadKey : undefined) ??
    threadRef?.questId;
  return {
    sourceThreadKey,
    routeThreadKey: sourceThreadKey,
    ...(questId ? { questId } : {}),
  };
}

function normalizeOptionalThreadKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeSelectedFeedThreadKey(value);
  return normalized || undefined;
}
