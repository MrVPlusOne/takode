import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";

const NOW = Date.now();

const RECOVERY_SUMMARY_MESSAGE: ChatMessage = {
  id: "playground-auto-pause-recovery",
  role: "system",
  content: "Automatic input recovery: 1 delivered, 1 suppressed.",
  timestamp: NOW,
  variant: "info",
  metadata: {
    threadKey: "q-42",
    questId: "q-42",
    codexAutoPauseRecoverySummary: {
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
      ],
    },
  },
};

export function PlaygroundAutoPauseRecoverySummary() {
  return <MessageBubble message={RECOVERY_SUMMARY_MESSAGE} sessionId="playground-auto-pause" showTimestamp={false} />;
}
