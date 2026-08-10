import { buildCodexAutoPauseRecoverySearchText } from "../../../server/codex-auto-pause-types.js";
import type {
  BrowserIncomingMessage,
  ChatMessage,
  CodexAutoPauseRecoverySummary,
  CodexResultErrorAutoPauseState,
} from "../../types.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { PausedInputChip } from "../SessionPauseComposerControls.js";
import { Card } from "./shared.js";

const NOW = Date.now();

function playgroundPause(family: CodexResultErrorAutoPauseState["family"]): CodexResultErrorAutoPauseState {
  return {
    family,
    fingerprint: `${family}:playground-private-fingerprint`,
    streak: family === "copilot_auth_refresh_exhausted" || family === "model_not_supported" ? 1 : 3,
    threshold: family === "copilot_auth_refresh_exhausted" || family === "model_not_supported" ? 1 : 3,
    pausedAt: NOW - 45_000,
    lastError: "PRIVATE RAW PROVIDER ERROR MUST NOT RENDER",
    lastErrorAt: NOW - 5_000,
    lastSourceKind: "manual",
    totalMatchingErrors: 4,
    heldInputs: [
      {
        id: `playground-${family}-held-herd`,
        queuedAt: NOW - 30_000,
        lastQueuedAt: NOW - 10_000,
        source: "programmatic",
        count: 3,
        message: {
          type: "user_message",
          content: "PRIVATE HELD HERD PAYLOAD MUST NOT RENDER",
          agentSource: { sessionId: "herd-events", sessionLabel: "PRIVATE TRUSTED ROUTE LABEL MUST NOT RENDER" },
        },
      },
      {
        id: `playground-${family}-held-timer`,
        queuedAt: NOW - 20_000,
        lastQueuedAt: NOW - 20_000,
        source: "programmatic",
        count: 1,
        message: {
          type: "user_message",
          content: "PRIVATE HELD TIMER PAYLOAD MUST NOT RENDER",
          agentSource: { sessionId: "timer:t1", sessionLabel: "Timer t1" },
        },
      },
    ],
  };
}

const PLAYGROUND_COPILOT_PAUSE = playgroundPause("copilot_auth_refresh_exhausted");
const PLAYGROUND_STREAM_PAUSE = playgroundPause("model_backend_stream_error");
const PLAYGROUND_UNSUPPORTED_MODEL_PAUSE = playgroundPause("model_not_supported");

function PlaygroundPauseFrame({
  autoPause,
  testing = false,
}: {
  autoPause: CodexResultErrorAutoPauseState;
  testing?: boolean;
}) {
  return (
    <div className="border-t border-cc-border bg-cc-card px-4 py-3">
      <div className="overflow-visible rounded-[14px] border border-cc-border bg-cc-input-bg">
        <PausedInputChip
          heldCount={0}
          autoPausedHeldCount={4}
          directComposerMessagesSend={true}
          pause={null}
          autoPause={autoPause}
          autoPauseRecoveryTesting={testing}
        />
        <textarea
          readOnly
          value={testing ? "Recovery test is in progress." : "Direct messages remain available."}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pb-1 pt-3 font-sans-ui text-sm text-cc-fg"
          style={{ minHeight: "36px" }}
        />
      </div>
    </div>
  );
}

export function PlaygroundAutoPauseBannerStates() {
  return (
    <>
      <Card label="Automatic recovery paused — Copilot cause">
        <PlaygroundPauseFrame autoPause={PLAYGROUND_COPILOT_PAUSE} />
      </Card>
      <div className="mt-4" />
      <Card label="Automatic recovery testing — repeated stream cause">
        <div data-testid="playground-auto-pause-mobile-width" className="max-w-[320px]">
          <PlaygroundPauseFrame autoPause={PLAYGROUND_STREAM_PAUSE} testing />
        </div>
      </Card>
      <div className="mt-4" />
      <Card label="Automatic recovery paused — unsupported selected model">
        <PlaygroundPauseFrame autoPause={PLAYGROUND_UNSUPPORTED_MODEL_PAUSE} />
      </Card>
      <div className="mt-4" />
      <Card label="Failed recovery remains held">
        <PlaygroundPauseFrame autoPause={PLAYGROUND_COPILOT_PAUSE} />
      </Card>
    </>
  );
}

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
