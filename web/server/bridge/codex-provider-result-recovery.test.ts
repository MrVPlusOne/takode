import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import {
  CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS,
  codexInitRecoveryRetryDelayMs,
  decideCodexProviderResultRecovery,
  isCodexTurnReplayProvablySafe,
  prepareCodexTurnForProviderRecovery,
} from "./codex-provider-result-recovery.js";

function result(overrides: Partial<CLIResultMessage> = {}): CLIResultMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "stream disconnected before completion: error sending request for url (https://example.test/responses)",
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 0,
    total_cost_usd: 0,
    stop_reason: "failed",
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    session_id: "session",
    codex_turn_id: "turn-1",
    uuid: "result-1",
    ...overrides,
  };
}

function turn(overrides: Partial<CodexOutboundTurn> = {}): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: ["input-1"], inputs: [] },
    userMessageId: "input-1",
    pendingInputIds: ["input-1"],
    userContent: "continue",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId: "turn-1",
    disconnectedAt: null,
    resumeConfirmedAt: null,
    ...overrides,
  };
}

const userMessage = {
  type: "user_message",
  id: "input-1",
  content: "continue",
  timestamp: 1,
} as BrowserIncomingMessage;

describe("Codex provider result recovery", () => {
  it("retries a recoverable acknowledged turn only when no assistant or tool evidence followed its user input", () => {
    // A backend acknowledgement alone is not replay permission. The persisted
    // post-user history must prove that no assistant/tool side effect occurred.
    const pending = turn();
    expect(decideCodexProviderResultRecovery({ messageHistory: [userMessage] }, result(), pending)).toEqual({
      kind: "recover",
      family: "model_backend_stream_error",
      retryTurn: true,
      attempt: 1,
    });
    expect(isCodexTurnReplayProvablySafe([userMessage], pending)).toBe(true);
  });

  it("allows the second proof-gated retry past only the matching transient audit result", () => {
    const pending = turn({ providerRecoveryAttempts: 1, turnId: "turn-2" });
    const transientResult: BrowserIncomingMessage = {
      type: "result",
      data: {
        ...result({ codex_turn_id: "turn-1", uuid: "result-attempt-1" }),
        codex_provider_retry: {
          family: "model_backend_stream_error",
          ownerId: "input-1",
          attempt: 1,
          maxAttempts: 2,
          startedAt: 10,
        },
      },
    };

    expect(
      decideCodexProviderResultRecovery({ messageHistory: [userMessage, transientResult] }, result(), pending),
    ).toEqual({
      kind: "recover",
      family: "model_backend_stream_error",
      retryTurn: true,
      attempt: 2,
    });
    expect(
      isCodexTurnReplayProvablySafe(
        [
          userMessage,
          {
            ...transientResult,
            data: {
              ...transientResult.data,
              codex_provider_retry: { ...transientResult.data.codex_provider_retry!, ownerId: "different-input" },
            },
          },
        ],
        pending,
      ),
    ).toBe(false);
  });

  it("refreshes connectivity without replay when assistant or tool output makes exact-once execution unprovable", () => {
    const pending = turn();
    const assistant = {
      type: "assistant",
      parent_tool_use_id: null,
      timestamp: 2,
      message: {
        id: "assistant-1",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo done" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    } as BrowserIncomingMessage;

    expect(decideCodexProviderResultRecovery({ messageHistory: [userMessage, assistant] }, result(), pending)).toEqual({
      kind: "recover",
      family: "model_backend_stream_error",
      retryTurn: false,
      attempt: 1,
    });
  });

  it("treats unsupported models as recoverable only with sanitized recent auth-recovery evidence", () => {
    const unsupported = result({
      result: '{"error":{"message":"The requested model is not supported.","code":"model_not_supported"}}',
    });
    expect(decideCodexProviderResultRecovery({ messageHistory: [userMessage] }, unsupported, turn())).toEqual({
      kind: "terminal_model_not_supported",
    });

    const corroborated = result({
      ...unsupported,
      codex_provider_failure_context: {
        family: "copilot_auth_refresh_invalidated",
        observedAt: 10,
      },
    });
    expect(decideCodexProviderResultRecovery({ messageHistory: [userMessage] }, corroborated, turn())).toEqual({
      kind: "recover",
      family: "copilot_auth_refresh_invalidated",
      retryTurn: true,
      attempt: 1,
    });
  });

  it("fails closed after the bounded result recovery budget", () => {
    const pending = turn({ providerRecoveryAttempts: CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS });
    expect(decideCodexProviderResultRecovery({ messageHistory: [userMessage] }, result(), pending)).toEqual({
      kind: "exhausted",
      family: "model_backend_stream_error",
      attempts: CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS,
    });
  });

  it("keeps nested init-error retries on the provider reconnect backoff", () => {
    expect(codexInitRecoveryRetryDelayMs("provider_result:model_backend_stream_error:attempt_1", 1)).toBe(30_000);
    expect(codexInitRecoveryRetryDelayMs("init_error:provider_result:model_backend_stream_error:attempt_1", 2)).toBe(
      60_000,
    );
    expect(codexInitRecoveryRetryDelayMs("init_error:provider_result:model_backend_stream_error:attempt_1", 3)).toBe(
      90_000,
    );
    expect(codexInitRecoveryRetryDelayMs("init_error:provider_result:model_backend_stream_error:attempt_1", 4)).toBe(
      120_000,
    );
  });

  it("re-arms the same persisted turn without creating a second pending-input owner", () => {
    const pending = turn();
    prepareCodexTurnForProviderRecovery(pending, "model_backend_stream_error", 1, 50);

    expect(pending).toMatchObject({
      status: "queued",
      providerRecoveryAttempts: 1,
      providerRecoveryFamily: "model_backend_stream_error",
      pendingInputIds: ["input-1"],
      userMessageId: "input-1",
      turnId: null,
      acknowledgedAt: null,
      updatedAt: 50,
    });
  });
});
