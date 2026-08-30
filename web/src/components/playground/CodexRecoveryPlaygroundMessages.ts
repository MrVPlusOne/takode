import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  codexTurnRecoverySourceId,
} from "../../../shared/injected-event-message.js";
import type { ChatMessage } from "../../types.js";
import { makePlaygroundMessage } from "./fixtures.js";

export function buildPlaygroundActionRequiredRecoveryMessages(recoveryId: string): ChatMessage[] {
  return [
    makePlaygroundMessage({
      id: "playground-interrupted-owner",
      role: "user",
      content: "Finish the interrupted leader work without repeating completed side effects.",
      timestamp: Date.now() - 8_000,
    }),
    makePlaygroundMessage({
      id: "playground-continuation-action-required",
      role: "user",
      content: "Takode is continuing an interrupted leader turn without replaying completed work.",
      timestamp: Date.now() - 6_000,
      agentSource: {
        sessionId: codexTurnRecoverySourceId(recoveryId),
        sessionLabel: CODEX_TURN_RECOVERY_SOURCE_LABEL,
      },
    }),
    makePlaygroundMessage({
      id: "playground-continuation-partial",
      role: "assistant",
      content: "I verified the already-completed side effects, but the continuation stopped before its final answer.",
      timestamp: Date.now() - 4_000,
    }),
    makePlaygroundMessage({
      id: "playground-codex-recovery-diagnostic-msg",
      role: "user",
      content: [
        "Codex recovery diagnostic: automatic replay stopped after the partial leader response above.",
        "No automatic replay will run because it could duplicate side effects. Review the partial response and send a new continuation instruction only if the intended outcome is still missing.",
      ].join("\n"),
      timestamp: Date.now() - 2_000,
      agentSource: {
        sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
        sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
      },
    }),
  ];
}
