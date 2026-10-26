import type { BrowserIncomingMessage } from "./session-types.js";

export interface IndexedToolResultPayload {
  content: string;
}

/**
 * Serialized size of each history entry, computed once per entry object. These stats are
 * recomputed on every subscribe and turn end, and serializing a leader's whole history took
 * about 200 ms each time. Entries are almost always appended and replaced rather than edited,
 * so a cached size stays right; the newest entries are measured afresh on every call because
 * a turn's last assistant message can still grow in place. An older entry edited in place
 * (for example a backfilled thread reference) keeps its old size, which only skews a display stat.
 */
const entryBytes = new WeakMap<object, number>();
const FRESHLY_MEASURED_TAIL = 20;

function measureEntry(entry: BrowserIncomingMessage): number {
  return Buffer.byteLength(JSON.stringify(entry), "utf-8");
}

/** Bytes of `JSON.stringify(entries)`, from per-entry sizes. */
function serializedArrayBytes(entries: readonly BrowserIncomingMessage[], start = 0): number {
  const count = entries.length - start;
  if (count <= 0) return 2;
  let total = 2 + (count - 1);
  const freshFrom = entries.length - FRESHLY_MEASURED_TAIL;
  for (let i = start; i < entries.length; i++) {
    const entry = entries[i]!;
    let bytes = i < freshFrom ? entryBytes.get(entry) : undefined;
    if (bytes === undefined) {
      bytes = measureEntry(entry);
      entryBytes.set(entry, bytes);
    }
    total += bytes;
  }
  return total;
}

/** Size of the history a browser replays: the serialized `messageHistory`. */
export function computeReplayHistoryBytes(messageHistory: readonly BrowserIncomingMessage[]): number {
  return serializedArrayBytes(messageHistory);
}

function retainedHistoryStart(messageHistory: readonly BrowserIncomingMessage[]): number {
  for (let i = messageHistory.length - 1; i >= 0; i--) {
    if (messageHistory[i]?.type === "compact_marker") return i;
  }
  return 0;
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
export function computeCodexRetainedPayloadBytes(
  messageHistory: readonly BrowserIncomingMessage[],
  toolResults: Map<string, IndexedToolResultPayload>,
): number {
  const start = retainedHistoryStart(messageHistory);
  const retainedHistoryBytes = serializedArrayBytes(messageHistory, start);

  let hiddenToolPayloadDelta = 0;

  for (let i = start; i < messageHistory.length; i++) {
    const message = messageHistory[i]!;
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
