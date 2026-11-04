import { withoutFrontMatter } from "../shared/slides.js";
import type { ChatMessage } from "./types.js";
import { getMessageMarkdown } from "./utils/copy-utils.js";

/**
 * The Markdown Read aloud reads for a message: a report's text without its front matter, else the
 * message's text. Every way of starting a read uses it (the message menu, a report's header,
 * voiceback), so they all read a message the same way.
 */
export function readAloudMessageText(message: ChatMessage): string {
  return message.metadata?.markdownReport ? withoutFrontMatter(message.content) : getMessageMarkdown(message);
}
