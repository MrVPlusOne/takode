import type { ChatMessage } from "../types.js";

export function isCodexReasoningDetailMessage(message: ChatMessage | null | undefined): message is ChatMessage & {
  metadata: { codexReasoningDetail: NonNullable<ChatMessage["metadata"]>["codexReasoningDetail"] };
} {
  return message?.role === "assistant" && message.metadata?.codexReasoningDetail != null;
}

export function parseCodexReasoningDetail(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  const titleMatch = trimmed.match(/^\*\*([^\n*][^\n]*?)\*\*(?:[ \t]*\n+|\s+|$)([\s\S]*)$/);
  if (!titleMatch?.[1]?.trim()) return { title: "Reasoning", body: trimmed };
  return {
    title: titleMatch[1].trim(),
    body: (titleMatch[2] ?? "").trim(),
  };
}

export function convertLegacyParentedCodexThinkingMessage(isCodexSession: boolean, message: ChatMessage): ChatMessage {
  const blocks = message.contentBlocks ?? [];
  if (
    !isCodexSession ||
    !message.parentToolUseId ||
    blocks.length === 0 ||
    !blocks.every((block) => block.type === "thinking")
  ) {
    return message;
  }
  const thinkingBlocks = blocks.filter(
    (block): block is Extract<(typeof blocks)[number], { type: "thinking" }> => block.type === "thinking",
  );
  const content = thinkingBlocks.map((block) => block.thinking).join("\n");
  const thinkingTimeMs = thinkingBlocks.find((block) => block.thinking_time_ms !== undefined)?.thinking_time_ms;
  return {
    ...message,
    content,
    contentBlocks: undefined,
    metadata: {
      ...message.metadata,
      codexReasoningDetail: {
        status: "complete",
        ...(thinkingTimeMs !== undefined ? { thinkingTimeMs } : {}),
      },
    },
  };
}
