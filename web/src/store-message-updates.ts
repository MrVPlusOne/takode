import type { AppState } from "./store-types.js";
import type { ChatMessage, ToolResultPreview } from "./types.js";

type CodexSubagentOwnership = NonNullable<NonNullable<ChatMessage["metadata"]>["codexSubagent"]>;

function sameToolResult(left: ToolResultPreview | undefined, right: ToolResultPreview): boolean {
  return (
    left?.tool_use_id === right.tool_use_id &&
    left.content === right.content &&
    left.is_error === right.is_error &&
    left.total_size === right.total_size &&
    left.is_truncated === right.is_truncated &&
    left.duration_seconds === right.duration_seconds &&
    left.synthetic_reason === right.synthetic_reason &&
    left.retained_output === right.retained_output
  );
}

function attachToolResultsToOwnedMessage(
  message: ChatMessage,
  ownership: CodexSubagentOwnership,
  previews: readonly ToolResultPreview[],
): ChatMessage {
  if (message.metadata?.codexSubagent?.childId !== ownership.childId) return message;
  const toolIds = new Set(
    (message.contentBlocks ?? []).flatMap((block) => (block.type === "tool_use" ? [block.id] : [])),
  );
  const matching = previews.filter((preview) => toolIds.has(preview.tool_use_id));
  if (matching.length === 0) return message;
  const existing = message.metadata.codexSubagentToolResults ?? {};
  if (matching.every((preview) => sameToolResult(existing[preview.tool_use_id], preview))) return message;
  return {
    ...message,
    metadata: {
      ...message.metadata,
      codexSubagentToolResults: {
        ...existing,
        ...Object.fromEntries(matching.map((preview) => [preview.tool_use_id, preview])),
      },
    },
  };
}

/** Attach child previews only to the matching child-owned tool-use message across authoritative views. */
export function attachCodexSubagentToolResultsAcrossSources(
  state: AppState,
  sessionId: string,
  ownership: CodexSubagentOwnership,
  previews: readonly ToolResultPreview[],
): Partial<AppState> {
  if (previews.length === 0) return {};
  const messages = new Map(state.messages);
  const list = messages.get(sessionId);
  let canonicalChanged = false;
  let updatedFrozen = false;
  const frozenCount = state.messageFrozenCounts.get(sessionId) ?? 0;
  const nextList = list?.map((message, index) => {
    const next = attachToolResultsToOwnedMessage(message, ownership, previews);
    if (next === message) return message;
    canonicalChanged = true;
    if (index < frozenCount) updatedFrozen = true;
    return next;
  });
  if (nextList && canonicalChanged) messages.set(sessionId, nextList);

  const threadWindowMessages = new Map(state.threadWindowMessages);
  const windows = threadWindowMessages.get(sessionId);
  let threadWindowChanged = false;
  if (windows) {
    const nextWindows = new Map(windows);
    for (const [threadKey, windowMessages] of windows) {
      let windowChanged = false;
      const nextMessages = windowMessages.map((message) => {
        const next = attachToolResultsToOwnedMessage(message, ownership, previews);
        if (next !== message) windowChanged = true;
        return next;
      });
      if (!windowChanged) continue;
      nextWindows.set(threadKey, nextMessages);
      threadWindowChanged = true;
    }
    if (threadWindowChanged) threadWindowMessages.set(sessionId, nextWindows);
  }

  if (!canonicalChanged && !threadWindowChanged) return {};
  const result: Partial<AppState> = {
    ...(canonicalChanged ? { messages } : {}),
    ...(threadWindowChanged ? { threadWindowMessages } : {}),
  };
  if (!updatedFrozen) return result;
  const messageFrozenRevisions = new Map(state.messageFrozenRevisions);
  messageFrozenRevisions.set(sessionId, (messageFrozenRevisions.get(sessionId) ?? 0) + 1);
  return { ...result, messageFrozenRevisions };
}

export function updateMessageAcrossSources(
  state: AppState,
  sessionId: string,
  messageId: string,
  updates: Partial<ChatMessage>,
): Partial<AppState> {
  const messages = new Map(state.messages);
  const list = messages.get(sessionId);
  let updatedFrozen = false;
  let canonicalChanged = false;
  const frozenCount = state.messageFrozenCounts.get(sessionId) ?? 0;
  const updated = list?.map((message, index) => {
    if (message.id !== messageId) return message;
    canonicalChanged = true;
    if (index < frozenCount) updatedFrozen = true;
    return { ...message, ...updates };
  });
  if (updated && canonicalChanged) messages.set(sessionId, updated);

  let threadWindowChanged = false;
  const threadWindowMessages = new Map(state.threadWindowMessages);
  const windows = threadWindowMessages.get(sessionId);
  if (windows) {
    const nextWindows = new Map(windows);
    for (const [threadKey, windowMessages] of windows) {
      let windowChanged = false;
      const nextMessages = windowMessages.map((message) => {
        if (message.id !== messageId) return message;
        windowChanged = true;
        return { ...message, ...updates };
      });
      if (windowChanged) {
        nextWindows.set(threadKey, nextMessages);
        threadWindowChanged = true;
      }
    }
    if (threadWindowChanged) threadWindowMessages.set(sessionId, nextWindows);
  }

  if (!canonicalChanged && !threadWindowChanged) return {};
  const result: Partial<AppState> = {
    ...(canonicalChanged ? { messages } : {}),
    ...(threadWindowChanged ? { threadWindowMessages } : {}),
  };
  if (!updatedFrozen) return result;
  const messageFrozenRevisions = new Map(state.messageFrozenRevisions);
  messageFrozenRevisions.set(sessionId, (messageFrozenRevisions.get(sessionId) ?? 0) + 1);
  return { ...result, messageFrozenRevisions };
}
