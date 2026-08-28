import { useMemo, useRef } from "react";
import type { ChatMessage, ContentBlock, ToolResultPreview } from "../types.js";
import { groupMessages } from "../hooks/use-feed-model.js";
import { FeedEntries } from "./MessageFeedEntries.js";
import { buildMinuteBoundaryLabelMap, isTimedChatMessage } from "./message-feed-utils.js";
import { PawCounterContext, type PawCounterState } from "./PawTrail.js";

export interface CodexSubagentTranscriptModel {
  messages: ChatMessage[];
  toolResults: Map<string, ToolResultPreview>;
}

function resultText(content: Extract<ContentBlock, { type: "tool_result" }>["content"]): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function utf8ByteLength(value: string): number {
  return typeof TextEncoder === "undefined" ? value.length : new TextEncoder().encode(value).byteLength;
}

/**
 * Convert the inspector's self-contained tool result blocks into the same
 * ToolResultPreview input consumed by the canonical main-feed ToolBlock.
 * Child ownership is already carried by the selected inspector row, so parent
 * tool IDs are cleared before feed grouping to avoid treating Codex item links
 * as legacy Task-subagent nesting.
 */
export function buildCodexSubagentTranscriptModel(messages: ChatMessage[]): CodexSubagentTranscriptModel {
  const toolResults = new Map<string, ToolResultPreview>();
  const displayMessages = messages.map((message) => {
    const blocks = message.contentBlocks;
    if (!blocks?.some((block) => block.type === "tool_result") && !message.parentToolUseId) return message;

    const visibleBlocks: ContentBlock[] = [];
    for (const block of blocks ?? []) {
      if (block.type !== "tool_result") {
        visibleBlocks.push(block);
        continue;
      }
      const content = resultText(block.content);
      const contentSize = utf8ByteLength(content);
      toolResults.set(block.tool_use_id, {
        tool_use_id: block.tool_use_id,
        content,
        is_error: block.is_error === true,
        total_size:
          typeof block.total_size === "number" && Number.isFinite(block.total_size)
            ? Math.max(contentSize, block.total_size)
            : contentSize,
        is_truncated: block.is_truncated === true,
        ...(typeof block.duration_seconds === "number" &&
        Number.isFinite(block.duration_seconds) &&
        block.duration_seconds >= 0
          ? { duration_seconds: block.duration_seconds }
          : {}),
      });
    }

    return {
      ...message,
      parentToolUseId: null,
      ...(blocks ? { contentBlocks: visibleBlocks } : {}),
    };
  });

  return { messages: displayMessages, toolResults };
}

export function CodexSubagentTranscript({ sessionId, messages }: { sessionId: string; messages: ChatMessage[] }) {
  const model = useMemo(() => buildCodexSubagentTranscriptModel(messages), [messages]);
  const entries = useMemo(() => groupMessages(model.messages), [model.messages]);
  const minuteBoundaryLabels = useMemo(
    () => buildMinuteBoundaryLabelMap(model.messages.filter(isTimedChatMessage)),
    [model.messages],
  );
  const pawCounter = useRef<PawCounterState>({ next: 0, cache: new Map() });
  const activeCodexTerminalIds = useMemo(() => new Set<string>(), []);

  return (
    <PawCounterContext.Provider value={pawCounter}>
      <div className="space-y-3 sm:space-y-5" data-testid="codex-subagent-transcript-feed">
        <FeedEntries
          entries={entries}
          sessionId={sessionId}
          minuteBoundaryLabels={minuteBoundaryLabels}
          isCodexSession
          activeCodexTerminalIds={activeCodexTerminalIds}
          onOpenCodexTerminal={() => {}}
          interactionMode="read-only"
          toolResultOverrides={model.toolResults}
          toolResultScope="overrides-only"
          suppressThreadSystemMarkers
        />
      </div>
    </PawCounterContext.Provider>
  );
}
