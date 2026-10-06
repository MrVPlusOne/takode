import type { BrowserIncomingMessage } from "./session-types.js";
import { buildToolSummary } from "./takode-messages.js";

export const SESSION_ACTIVITY_PREVIEW_LINE_LIMIT = 4;
/** History entries scanned from the tail; keeps the preview cheap on very long sessions. */
const MAX_SCANNED_MESSAGES = 400;
const MAX_LINE_TEXT_LENGTH = 160;

export interface SessionActivityPreviewLine {
  /** messageHistory index of the message that produced this line, for deep links. */
  historyIndex: number;
  kind: "tool" | "message";
  /** Tool name for tool lines. */
  toolName?: string;
  /** One-line tool summary or assistant text excerpt. */
  text: string;
  timestamp: number | null;
}

export interface SessionActivityPreview {
  /** Newest last. */
  lines: SessionActivityPreviewLine[];
  /** Timestamp of the newest timestamped history entry, or null when none was found. */
  lastActivityAt: number | null;
}

/**
 * Build a bounded, glanceable slice of a session's latest own actions: tool calls
 * and one-line excerpts of assistant text. Subagent-internal messages are skipped
 * so the preview reflects what the session itself is doing.
 */
export function buildSessionActivityPreview(
  messageHistory: readonly BrowserIncomingMessage[],
  limit = SESSION_ACTIVITY_PREVIEW_LINE_LIMIT,
): SessionActivityPreview {
  const lines: SessionActivityPreviewLine[] = [];
  const seenToolIds = new Set<string>();
  const seenTexts = new Set<string>();
  let lastActivityAt: number | null = null;
  const stopIndex = Math.max(0, messageHistory.length - MAX_SCANNED_MESSAGES);

  for (let index = messageHistory.length - 1; index >= stopIndex && lines.length < limit; index -= 1) {
    const message = messageHistory[index];
    const timestamp = messageTimestamp(message);
    if (lastActivityAt === null && timestamp !== null) lastActivityAt = timestamp;
    if (message?.type !== "assistant" || message.parent_tool_use_id) continue;

    // Blocks are walked newest-first so `lines` stays newest-first until the final reverse.
    const blocks = message.message?.content ?? [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0 && lines.length < limit; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type === "tool_use") {
        if (seenToolIds.has(block.id)) continue;
        seenToolIds.add(block.id);
        lines.push({
          historyIndex: index,
          kind: "tool",
          toolName: block.name,
          text: oneLine(buildToolSummary(block.name, block.input ?? {})),
          timestamp,
        });
      } else if (block.type === "text") {
        const text = oneLine(firstNonEmptyLine(block.text));
        const key = `${message.message.id}\u0000${text}`;
        if (!text || seenTexts.has(key)) continue;
        seenTexts.add(key);
        lines.push({ historyIndex: index, kind: "message", text, timestamp });
      }
    }
  }

  return { lines: lines.reverse(), lastActivityAt };
}

function messageTimestamp(message: BrowserIncomingMessage | undefined): number | null {
  const timestamp = (message as { timestamp?: unknown } | undefined)?.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_LINE_TEXT_LENGTH ? `${collapsed.slice(0, MAX_LINE_TEXT_LENGTH - 1)}…` : collapsed;
}
