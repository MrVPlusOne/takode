/**
 * Reply-to-message injection and parsing.
 *
 * Uses unique delimiter strings that won't appear in natural conversation:
 *   <<<REPLY_TO>>>preview text here<<<END_REPLY>>>
 *
 * The preview text is inserted verbatim between the delimiters -- no escaping
 * needed because the delimiters themselves are impossible in normal text.
 * The actual user message follows after the closing delimiter (separated by \n\n).
 */

const REPLY_OPEN = "<<<REPLY_TO>>>";
const REPLY_CLOSE = "<<<END_REPLY>>>";

/** Wrap a reply preview and user message into the wire format sent to the assistant. */
export function injectReplyContext(previewText: string, userMessage: string): string {
  return `${REPLY_OPEN}${previewText}${REPLY_CLOSE}\n\n${userMessage}`;
}

/** Parsed reply context extracted from a user message, or null if none. */
export interface ParsedReplyContext {
  previewText: string;
  userMessage: string;
}

/** Extract reply context from message content. Returns null if no reply prefix is present. */
export function parseReplyContext(content: string): ParsedReplyContext | null {
  if (!content.startsWith(REPLY_OPEN)) return null;

  const closeIdx = content.indexOf(REPLY_CLOSE, REPLY_OPEN.length);
  if (closeIdx === -1) return null;

  const previewText = content.slice(REPLY_OPEN.length, closeIdx);
  // Skip the closing delimiter + up to two newlines that separate the reply tag from the message
  let bodyStart = closeIdx + REPLY_CLOSE.length;
  if (content[bodyStart] === "\n") bodyStart++;
  if (content[bodyStart] === "\n") bodyStart++;
  const userMessage = content.slice(bodyStart);

  return { previewText, userMessage };
}
