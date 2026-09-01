import type { BrowserIncomingMessage } from "./session-types.js";

/** Root-facing feeds omit proven child ownership and server-retired recovery diagnostics. */
export function isRootAgentHistoryMessage(message: BrowserIncomingMessage): boolean {
  if (message.codexSubagent != null) return false;
  if (message.type === "user_message" && message.codexTurnRecoveryResolvedAt != null) return false;
  return true;
}
