import { buildCodexAutoPauseRecoverySearchText } from "../../../server/codex-auto-pause-types.js";
import type { BrowserIncomingMessage, ChatMessage, CodexAutoPauseRecoverySummary } from "../../types.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";

const NOW = Date.now();

const RECOVERY: CodexAutoPauseRecoverySummary = {
  family: "copilot_auth_refresh_exhausted",
  pausedAt: NOW - 120_000,
  recoveryConfirmedAt: NOW - 60_000,
  updatedAt: NOW - 15_000,
  status: "settled",
  receipts: [
    {
      groupId: "codex-auto-pause-group-turn-end",
      source: "programmatic",
      sourceLabel: "Herd Events",
      sourceDetail: "turn_end",
      count: 2,
      coalescedCount: 1,
      survivingGroupId: "codex-auto-pause-group-turn-end",
      queuedAt: NOW - 110_000,
      lastQueuedAt: NOW - 90_000,
      releasedAt: NOW - 60_000,
      terminalAt: NOW - 58_000,
      completedAt: NOW - 15_000,
      recovered: true,
      outcome: "delivered",
      reasonCode: "codex_delivery_recovered",
      reason: "Accepted by Codex exactly once and completed after automatic turn recovery.",
    },
    {
      groupId: "codex-auto-pause-group-board-stalled",
      source: "programmatic",
      sourceLabel: "Herd Events",
      sourceDetail: "board_stalled",
      count: 1,
      coalescedCount: 0,
      queuedAt: NOW - 100_000,
      lastQueuedAt: NOW - 100_000,
      releasedAt: NOW - 60_000,
      terminalAt: NOW - 57_000,
      outcome: "suppressed",
      reasonCode: "stale_board_state",
      reason: "Suppressed because the authoritative board state no longer matched the stalled event.",
    },
    {
      groupId: "codex-auto-pause-group-interrupted",
      source: "programmatic",
      sourceLabel: "Timer",
      sourceDetail: "turn_end",
      count: 1,
      coalescedCount: 0,
      queuedAt: NOW - 80_000,
      lastQueuedAt: NOW - 80_000,
      releasedAt: NOW - 60_000,
      terminalAt: NOW - 55_000,
      finalizedAt: NOW - 10_000,
      finalityReason: "turn_interrupted_or_cancelled",
      outcome: "delivered",
      reasonCode: "codex_delivery_accepted",
      reason: "Accepted by Codex exactly once.",
    },
  ],
};

export const PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY: Extract<
  BrowserIncomingMessage,
  { type: "codex_auto_pause_recovery_summary" }
> = {
  type: "codex_auto_pause_recovery_summary",
  id: "playground-auto-pause-recovery",
  timestamp: NOW,
  content: "Automatic input recovery: 2 delivered, 1 suppressed.",
  searchText: buildCodexAutoPauseRecoverySearchText(RECOVERY),
  recovery: RECOVERY,
  threadKey: "q-42",
  questId: "q-42",
  threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
};

export function buildPlaygroundAutoPauseRecoveryMessage(
  entry: Extract<
    BrowserIncomingMessage,
    { type: "codex_auto_pause_recovery_summary" }
  > = PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY,
): ChatMessage {
  const [message] = normalizeHistoryMessageToChatMessages(entry, 42);
  if (!message) throw new Error("Playground recovery summary failed production history normalization");
  return message;
}
