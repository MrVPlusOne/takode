import type { ChatMessage, ContentBlock } from "../types.js";

export function stripRootCodexThinkingBlocks(
  isCodexSession: boolean,
  parentToolUseId: string | null | undefined,
  blocks: ContentBlock[],
): ContentBlock[] {
  if (parentToolUseId || !isCodexSession || !blocks.some((block) => block.type === "thinking")) return blocks;
  return blocks.filter((block) => block.type !== "thinking");
}

export function stripRootCodexThinkingMessage(isCodexSession: boolean, message: ChatMessage): ChatMessage | null {
  const blocks = message.contentBlocks;
  if (!blocks?.some((block) => block.type === "thinking")) return message;
  const nextBlocks = stripRootCodexThinkingBlocks(isCodexSession, message.parentToolUseId, blocks);
  if (nextBlocks === blocks) return message;
  const nextContent = nextBlocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (
    message.role === "assistant" &&
    nextContent.trim().length === 0 &&
    nextBlocks.length === 0 &&
    !message.notification &&
    !(message.images?.length || message.localImages?.length)
  ) {
    return null;
  }
  return { ...message, content: nextContent, contentBlocks: nextBlocks };
}

export function stripRootCodexThinkingMessages(
  messages: ChatMessage[],
  frozenCount: number,
): { messages: ChatMessage[]; frozenCount: number } {
  const nextMessages: ChatMessage[] = [];
  let nextFrozenCount = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = stripRootCodexThinkingMessage(true, messages[index]!);
    if (!message) continue;
    nextMessages.push(message);
    if (index < frozenCount) nextFrozenCount++;
  }
  return { messages: nextMessages, frozenCount: nextFrozenCount };
}

function mergeToolUseInputValues(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    if (typeof value === "string") {
      if (value.trim().length > 0 || !(key in merged)) merged[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 || !(key in merged)) merged[key] = value;
      continue;
    }
    if (typeof value === "object") {
      const previous = merged[key];
      if (previous && typeof previous === "object" && !Array.isArray(previous)) {
        merged[key] = mergeToolUseInputValues(previous as Record<string, unknown>, value as Record<string, unknown>);
      } else if (!(key in merged) || Object.keys(value as Record<string, unknown>).length > 0) {
        merged[key] = value;
      }
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

/** Merge accumulated versions of one assistant message without duplicating stable content blocks. */
export function mergeAssistantContentBlocks(existing: ContentBlock[], incoming: ContentBlock[]): ContentBlock[] {
  const seenToolIds = new Set<string>();
  const toolIdToIndex = new Map<string, number>();
  const seenTexts = new Set<string>();
  const result: ContentBlock[] = [];

  for (const block of existing) {
    if (block.type === "tool_use" && block.id) {
      seenToolIds.add(block.id);
      toolIdToIndex.set(block.id, result.length);
    } else if (block.type === "text") {
      seenTexts.add(block.text);
    } else if (block.type === "thinking") {
      seenTexts.add(`thinking:${block.thinking}`);
    }
    result.push(block);
  }

  for (const block of incoming) {
    if (block.type === "tool_use" && block.id) {
      if (seenToolIds.has(block.id)) {
        const idx = toolIdToIndex.get(block.id);
        if (idx != null) {
          const previous = result[idx];
          if (previous?.type === "tool_use") {
            result[idx] = {
              ...previous,
              name: block.name || previous.name,
              input: mergeToolUseInputValues(previous.input || {}, block.input || {}),
            };
          }
        }
        continue;
      }
      seenToolIds.add(block.id);
      toolIdToIndex.set(block.id, result.length);
    } else if (block.type === "text") {
      if (seenTexts.has(block.text)) continue;
      seenTexts.add(block.text);
    } else if (block.type === "thinking") {
      if (seenTexts.has(`thinking:${block.thinking}`)) continue;
      seenTexts.add(`thinking:${block.thinking}`);
    }
    result.push(block);
  }

  return result;
}
