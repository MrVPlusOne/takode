import type { BrowserIncomingMessage } from "./session-types.js";

/** Root-facing feed and search projections exclude only proven native Codex child ownership. */
export function isRootAgentHistoryMessage(message: BrowserIncomingMessage): boolean {
  return message.codexSubagent == null;
}
