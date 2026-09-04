import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, CodexTurnRecoveryState } from "../session-types.js";
import { projectBrowserMessage } from "./browser-message-projection.js";

function recovery(status: CodexTurnRecoveryState["status"]): CodexTurnRecoveryState {
  return {
    recoveryId: "recovery-owner",
    originalOwnerId: "recovery-owner",
    originalProviderTurnId: "provider-turn",
    originalHistoryIndex: 7,
    continuationOwnerId: "continuation-owner",
    threadKey: "q-9010",
    questId: "q-9010",
    status,
    reason: status === "action_required" ? "continuation_interrupted" : "interrupted_after_activity",
    historyPresence: "present",
    continuationMode: "verify_then_continue",
    attempt: 1,
    maxAttempts: 1,
    createdAt: 100,
    updatedAt: 200,
  };
}

describe("browser interrupted-work recovery projection", () => {
  it("omits action-required attention from session snapshots without mutating server state", () => {
    const internalRecovery = recovery("action_required");
    const message = {
      type: "session_init",
      session: { session_id: "s1", codex_turn_recovery: internalRecovery },
    } as BrowserIncomingMessage;

    const projected = projectBrowserMessage(message);

    expect(projected).toMatchObject({ type: "session_init", session: { codex_turn_recovery: null } });
    expect(message).toMatchObject({ session: { codex_turn_recovery: internalRecovery } });
  });

  it("preserves active recovery progress", () => {
    const activeRecovery = recovery("continuation_active");
    const progress = {
      type: "session_update",
      session: { codex_turn_recovery: activeRecovery },
    } as BrowserIncomingMessage;

    expect(projectBrowserMessage(progress)).toBe(progress);
  });

  it("preserves unrelated actionable errors while suppressing terminal recovery attention", () => {
    const internalRecovery = recovery("action_required");
    const update = {
      type: "session_update",
      session: { codex_turn_recovery: internalRecovery, backend_error: "terminal session failure" },
    } as BrowserIncomingMessage;
    const error = { type: "error", message: "terminal session failure" } as BrowserIncomingMessage;

    expect(projectBrowserMessage(update)).toMatchObject({
      type: "session_update",
      session: { codex_turn_recovery: null, backend_error: "terminal session failure" },
    });
    expect(projectBrowserMessage(error)).toBe(error);
  });

  it("removes action-required recovery from state snapshots and legacy replay events", () => {
    const internalRecovery = recovery("action_required");
    const snapshot = {
      type: "state_snapshot",
      sessionStatus: null,
      permissionMode: "default",
      backendConnected: true,
      codexTurnRecovery: internalRecovery,
      uiMode: null,
      askPermission: true,
    } as BrowserIncomingMessage;
    const replay = {
      type: "event_replay",
      events: [
        {
          seq: 9,
          message: {
            type: "session_update",
            session: { codex_turn_recovery: internalRecovery },
          } as BrowserIncomingMessage,
        },
      ],
    } as BrowserIncomingMessage;

    expect(projectBrowserMessage(snapshot)).toMatchObject({ type: "state_snapshot", codexTurnRecovery: null });
    expect(projectBrowserMessage(replay)).toMatchObject({
      type: "event_replay",
      events: [{ seq: 9, message: { type: "session_update", session: { codex_turn_recovery: null } } }],
    });
  });

  it("preserves exact trusted model-bound audit content", () => {
    const audit = {
      type: "user_message",
      id: "recovery-audit",
      content: "Short visible recovery summary",
      modelDeliveryContent: "Exact model-bound recovery instructions",
      timestamp: 300,
      agentSource: {
        sessionId: "system:codex-turn-recovery:recovery-owner",
        sessionLabel: "Resuming Interrupted Work",
      },
    } as BrowserIncomingMessage;

    expect(projectBrowserMessage(audit)).toBe(audit);
    expect(projectBrowserMessage(audit)).toMatchObject({
      modelDeliveryContent: "Exact model-bound recovery instructions",
    });
  });
});
