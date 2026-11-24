import type { BrowserOutgoingMessage, SessionState } from "../session-types.js";
import { sessionTag } from "../session-tag.js";

/**
 * Image data (base64 characters, as Claude Code sends it) a Claude session's
 * context may hold before Takode compacts it.
 *
 * Claude Code resends every image in the context with each model request, and
 * Copilot fails a request whose body it cannot read within 60 s (HTTP 408).
 * From the laptop that happened at about 11 MB of images (a ~12 MB request)
 * after a request with slightly less had already taken 82 s, while the same
 * uplink had moved ~10 MB in 35 s minutes earlier, so its rate varies about 2x.
 * 5 MB of images plus the text of a large context (1-2 MB at 300-500K tokens)
 * keeps requests near half of the size that failed. It still holds 60 or so
 * renders once Read re-encodes them as WebP (`claude-read-image-hook.ts`), so
 * compaction stays rare. Token-based auto-compaction never gets there first:
 * 11 MB of renders were only ~70K tokens.
 */
export const CLAUDE_CONTEXT_IMAGE_BUDGET_CHARS = 5 * 1024 * 1024;

const COMPACT_COMMAND = "/compact";

export interface ClaudeImageCompactionSession {
  id: string;
  cliResuming?: boolean;
  state: Pick<SessionState, "claude_context_image_chars">;
}

/** Sessions whose `/compact`, sent ahead of a turn's message, has not answered yet. */
const compactionsInFlight = new WeakSet<ClaudeImageCompactionSession>();

/**
 * Count the images a Claude SDK message adds to the session's own context
 * (tool results and prompts of the main thread, not sub-agents'), and start
 * over when the context is compacted. Replays during resume are history
 * already counted.
 */
export function trackClaudeContextImages(session: ClaudeImageCompactionSession, msg: any): void {
  if (session.cliResuming) return;
  if (msg?.type === "system" && msg.subtype === "compact_boundary") {
    session.state.claude_context_image_chars = 0;
    return;
  }
  if (msg?.type !== "user" || msg.parent_tool_use_id) return;
  const added = imageChars(msg.message?.content);
  if (added > 0) session.state.claude_context_image_chars = (session.state.claude_context_image_chars ?? 0) + added;
}

/**
 * Before a new turn's message goes to Claude, compact the session first when
 * its images passed the budget: `/compact` sent just ahead of the message runs
 * before it, so the turn's own requests carry no old images. Returns whether
 * it was sent. Only for a message that starts a turn: mid-turn input joins a
 * request already under way.
 */
export function compactBeforeTurnIfImageHeavy(
  session: ClaudeImageCompactionSession,
  adapter: { sendBrowserMessage(msg: BrowserOutgoingMessage): boolean },
): boolean {
  const chars = session.state.claude_context_image_chars ?? 0;
  if (chars < CLAUDE_CONTEXT_IMAGE_BUDGET_CHARS || compactionsInFlight.has(session)) return false;
  if (!adapter.sendBrowserMessage({ type: "user_message", content: COMPACT_COMMAND })) return false;
  compactionsInFlight.add(session);
  console.log(
    `[claude-image-compaction] Compacting session ${sessionTag(session.id)} before its next turn: ` +
      `${(chars / 1024 / 1024).toFixed(1)} MB of images in its context`,
  );
  return true;
}

/**
 * Take the result Claude Code reports for that `/compact`, so the turn ends
 * with its message's result instead. Claude Code runs the message after the
 * compaction even when it fails or an interrupt cancels it (2.1.311 answers
 * "Compaction canceled." and goes on), so that result always follows.
 * Returns true when the message was consumed.
 */
export function consumeImageCompactionResult(session: ClaudeImageCompactionSession, msg: any): boolean {
  if (msg?.type !== "result" || !compactionsInFlight.has(session)) return false;
  compactionsInFlight.delete(session);
  const data = msg.data ?? msg;
  if (data?.is_error) {
    console.warn(
      `[claude-image-compaction] Compaction before the turn failed for session ${sessionTag(session.id)}: ` +
        `${String(data.result ?? data.subtype ?? "unknown error")}`,
    );
  }
  return true;
}

function imageChars(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (block?.type === "image" && typeof block.source?.data === "string") chars += block.source.data.length;
    if (block?.type === "tool_result") chars += imageChars(block.content);
  }
  return chars;
}
