import { normalizeCodexMessagePhase } from "../../shared/codex-message-phase.js";
import { sameCodexNativeSubagentOwnership } from "../../shared/codex-native-subagent-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { routeFromHistoryEntry, sameThreadRoute } from "../thread-routing-metadata.js";
import type { Session } from "./ws-bridge-session.js";

const CODEX_ASSISTANT_REPLAY_DEDUP_WINDOW_MS = 15_000;
const CODEX_ASSISTANT_REPLAY_SCAN_LIMIT = 200;

/**
 * Codex can replay prior assistant messages after reconnect. Deduplicate only
 * when the canonical assistant ID matches, or when timestamp + content +
 * parent tool context all match a recent assistant. This keeps the fallback
 * filter narrow so legitimate repeated text still appears.
 */
export function isDuplicateCodexAssistantReplay(
  session: Session,
  msg: Extract<BrowserIncomingMessage, { type: "assistant" }>,
): boolean {
  const incomingId = typeof msg.message?.id === "string" ? msg.message.id : null;
  if (!incomingId && typeof msg.timestamp !== "number") return false;

  const incomingTimestamp = typeof msg.timestamp === "number" ? msg.timestamp : null;
  const incomingParentToolUseId = msg.parent_tool_use_id;
  const incomingContentKey = JSON.stringify(msg.message.content);

  let scannedAssistants = 0;
  for (let i = session.messageHistory.length - 1; i >= 0; i--) {
    const entry = session.messageHistory[i];
    if (entry.type !== "assistant") continue;
    scannedAssistants += 1;
    if (scannedAssistants > CODEX_ASSISTANT_REPLAY_SCAN_LIMIT) break;

    const existing = entry as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    const sameOwnership = sameCodexNativeSubagentOwnership(existing.codexSubagent, msg.codexSubagent);
    if (incomingId && existing.message?.id === incomingId && sameOwnership) return true;
    if (!sameOwnership) continue;
    if (existing.parent_tool_use_id !== incomingParentToolUseId) continue;
    if (!sameThreadRoute(routeFromHistoryEntry(existing), routeFromHistoryEntry(msg))) continue;
    if (normalizeCodexMessagePhase(existing.codexMessagePhase) !== normalizeCodexMessagePhase(msg.codexMessagePhase)) {
      continue;
    }
    if (incomingTimestamp == null || typeof existing.timestamp !== "number") continue;
    if (Math.abs(existing.timestamp - incomingTimestamp) > CODEX_ASSISTANT_REPLAY_DEDUP_WINDOW_MS) continue;
    if (JSON.stringify(existing.message.content) !== incomingContentKey) continue;

    return true;
  }

  return false;
}
