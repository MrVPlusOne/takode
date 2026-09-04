import { extractThreadStatusMarkersFromText } from "../../shared/thread-status-marker.js";
import { parseThreadTextPrefix } from "../../shared/thread-routing.js";
import type { ChatMessage, ContentBlock } from "../types.js";
import { stripRootCodexThinkingBlocks } from "./assistant-content-blocks.js";

const HIDDEN_ASSISTANT_TOOL_NAMES = new Set(["write_stdin"]);

export interface AssistantMessageRenderContext {
  isCodexSession?: boolean;
  hasAnchoredNotification?: boolean;
  hasVisibleSideChat?: boolean;
}

export interface AssistantMessageRenderProjection {
  blocks: ContentBlock[];
  fallbackText: string;
  hasSuppressedRootCodexThinkingBlock: boolean;
  hasTextBlock: boolean;
  hasThinkingBlock: boolean;
  shouldRenderContentFallback: boolean;
  renderable: boolean;
}

export function isToolHiddenFromChat(name: string): boolean {
  return HIDDEN_ASSISTANT_TOOL_NAMES.has(name);
}

function projectAssistantVisibleText(text: string): string {
  const withoutStatuses = extractThreadStatusMarkersFromText(text).text;
  const routed = parseThreadTextPrefix(withoutStatuses);
  return routed.ok ? routed.body : withoutStatuses;
}

function projectAssistantBlocks(
  message: ChatMessage,
  isCodexSession: boolean,
): {
  blocks: ContentBlock[];
  hasSuppressedRootCodexThinkingBlock: boolean;
} {
  const rawBlocks = message.contentBlocks ?? [];
  const withoutSuppressedThinking = stripRootCodexThinkingBlocks(isCodexSession, message.parentToolUseId, rawBlocks);
  const blocks: ContentBlock[] = [];

  for (const block of withoutSuppressedThinking) {
    if (block.type === "text") {
      const text = projectAssistantVisibleText(block.text);
      if (text.trim()) blocks.push({ ...block, text });
      continue;
    }
    if (block.type === "thinking") {
      if (block.thinking.trim()) blocks.push(block);
      continue;
    }
    if (block.type === "tool_use" && isToolHiddenFromChat(block.name)) continue;
    blocks.push(block);
  }

  return {
    blocks,
    hasSuppressedRootCodexThinkingBlock: withoutSuppressedThinking !== rawBlocks,
  };
}

export function projectAssistantMessageForRendering(
  message: ChatMessage,
  context: AssistantMessageRenderContext = {},
): AssistantMessageRenderProjection {
  const { blocks, hasSuppressedRootCodexThinkingBlock } = projectAssistantBlocks(
    message,
    context.isCodexSession === true,
  );
  const hasTextBlock = blocks.some((block) => block.type === "text" && block.text.trim().length > 0);
  const hasThinkingBlock = blocks.some((block) => block.type === "thinking" && block.thinking.trim().length > 0);
  const fallbackText = projectAssistantVisibleText(message.content ?? "");
  const shouldRenderContentFallback =
    fallbackText.trim().length > 0 && !hasTextBlock && !hasThinkingBlock && !hasSuppressedRootCodexThinkingBlock;
  const hasVisibleBlock = blocks.length > 0;
  const hasVisibleChild =
    message.notification != null ||
    context.hasAnchoredNotification === true ||
    context.hasVisibleSideChat === true ||
    (message.images?.length ?? 0) > 0 ||
    (message.localImages?.length ?? 0) > 0 ||
    message.metadata?.attentionRecord != null ||
    message.metadata?.codexReasoningDetail != null;

  return {
    blocks,
    fallbackText,
    hasSuppressedRootCodexThinkingBlock,
    hasTextBlock,
    hasThinkingBlock,
    shouldRenderContentFallback,
    renderable: message.role !== "assistant" || hasVisibleBlock || shouldRenderContentFallback || hasVisibleChild,
  };
}

export function getAssistantVisibleMarkdown(message: ChatMessage, context: AssistantMessageRenderContext = {}): string {
  const projection = projectAssistantMessageForRendering(message, context);
  const textBlocks = projection.blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
  if (textBlocks.length > 0) return textBlocks.join("\n\n");
  return projection.shouldRenderContentFallback ? projection.fallbackText : "";
}

export function isAssistantMessageRenderable(
  message: ChatMessage,
  context: AssistantMessageRenderContext = {},
): boolean {
  return projectAssistantMessageForRendering(message, context).renderable;
}
