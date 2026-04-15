import type { BrowserIncomingMessage } from "./session-types.js";

export interface IndexedToolResultPayload {
  content: string;
}

export interface SessionPayloadMetrics {
  replayHistoryBytes: number;
  codexRetainedPayloadBytes: number;
}

function computeReplayHistoryBytes(messageHistory: BrowserIncomingMessage[]): number {
  return Buffer.byteLength(JSON.stringify(messageHistory), "utf-8");
}

function getRetainedHistorySlice(messageHistory: BrowserIncomingMessage[]): BrowserIncomingMessage[] {
  for (let i = messageHistory.length - 1; i >= 0; i--) {
    if (messageHistory[i]?.type === "compact_marker") {
      return messageHistory.slice(i);
    }
  }
  return messageHistory;
}

function isToolResultPreviewMessage(
  message: BrowserIncomingMessage,
): message is Extract<BrowserIncomingMessage, { type: "tool_result_preview" }> {
  return message.type === "tool_result_preview" && Array.isArray(message.previews);
}

/**
 * Estimate how much payload Codex still retains after Takode has collapsed full
 * tool results into browser-facing preview entries. The replay history already
 * includes the preview payload, so only add the hidden delta between preview
 * text and the indexed full result content.
 */
function computeCodexRetainedPayloadBytes(
  messageHistory: BrowserIncomingMessage[],
  toolResults: Map<string, IndexedToolResultPayload>,
): number {
  const retainedHistory = getRetainedHistorySlice(messageHistory);
  const retainedHistoryBytes = Buffer.byteLength(JSON.stringify(retainedHistory), "utf-8");

  let hiddenToolPayloadDelta = 0;

  for (const message of retainedHistory) {
    if (!isToolResultPreviewMessage(message)) continue;
    for (const preview of message.previews) {
      const previewBytes = Buffer.byteLength(preview.content, "utf-8");
      const fullResult = toolResults.get(preview.tool_use_id);
      const fullBytes = fullResult
        ? Buffer.byteLength(fullResult.content, "utf-8")
        : Math.max(preview.total_size, previewBytes);
      hiddenToolPayloadDelta += Math.max(0, fullBytes - previewBytes);
    }
  }

  return retainedHistoryBytes + hiddenToolPayloadDelta;
}

export function computeSessionPayloadMetrics(
  messageHistory: BrowserIncomingMessage[],
  toolResults: Map<string, IndexedToolResultPayload>,
): SessionPayloadMetrics {
  const replayHistoryBytes = computeReplayHistoryBytes(messageHistory);
  return {
    replayHistoryBytes,
    codexRetainedPayloadBytes: computeCodexRetainedPayloadBytes(messageHistory, toolResults),
  };
}
