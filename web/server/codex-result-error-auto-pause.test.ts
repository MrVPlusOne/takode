import { describe, expect, it } from "vitest";
import {
  classifyCodexResultError,
  determineCodexTurnSourceKind,
  determineUserMessageSourceKind,
  getCodexAutoPauseHeldInputCount,
  materializeCodexAutoPausedInputsForDrain,
  noteCodexResultForAutoPause,
  queueCodexAutoPausedInput,
} from "./codex-result-error-auto-pause.js";
import type { CLIResultMessage, CodexOutboundTurn, PendingCodexInput, SessionState } from "./session-types.js";

function result(overrides: Partial<CLIResultMessage> = {}): CLIResultMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "stream disconnected before completion: error sending request for url (http://localhost:4000/responses)",
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1,
    total_cost_usd: 0,
    stop_reason: "failed",
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    session_id: "codex-session",
    codex_turn_id: "turn-1",
    uuid: "result-1",
    ...overrides,
  };
}

function session(): { state: Pick<SessionState, "codex_result_error_auto_pause"> } {
  return { state: { codex_result_error_auto_pause: null } };
}

function turn(sourceKind: "manual" | "automatic"): Pick<CodexOutboundTurn, "autoPauseSourceKind"> {
  return { autoPauseSourceKind: sourceKind };
}

describe("Codex result-error auto-pause", () => {
  it("classifies only narrow Codex terminal responses backend stream errors", () => {
    expect(classifyCodexResultError(result())?.fingerprint).toBe("model_backend_stream_error:responses");
    expect(classifyCodexResultError(result({ codex_turn_id: undefined }))).toBeNull();
    expect(classifyCodexResultError(result({ is_error: false, result: "ok" }))).toBeNull();
    expect(classifyCodexResultError(result({ result: "permission denied by user" }))).toBeNull();
  });

  it("counts consecutive classified errors and pauses at the threshold without using recovery state", () => {
    const s = session();

    expect(noteCodexResultForAutoPause(s, result({ uuid: "r1" }), turn("automatic"), 100)).toMatchObject({
      pausedNow: false,
    });
    expect(noteCodexResultForAutoPause(s, result({ uuid: "r2" }), turn("automatic"), 200)).toMatchObject({
      pausedNow: false,
    });
    const third = noteCodexResultForAutoPause(s, result({ uuid: "r3" }), turn("automatic"), 300);

    expect(third.pausedNow).toBe(true);
    expect(s.state.codex_result_error_auto_pause).toMatchObject({
      streak: 3,
      threshold: 3,
      pausedAt: 300,
      fingerprint: "model_backend_stream_error:responses",
    });
  });

  it("resets a non-paused streak after a successful result", () => {
    const s = session();
    noteCodexResultForAutoPause(s, result({ uuid: "r1" }), turn("automatic"), 100);

    const reset = noteCodexResultForAutoPause(
      s,
      result({ is_error: false, result: "ok", subtype: "success", stop_reason: "end_turn" }),
      turn("automatic"),
      200,
    );

    expect(reset.changed).toBe(true);
    expect(s.state.codex_result_error_auto_pause).toBeNull();
  });

  it("keeps automatic sources paused after a matching manual failure and resumes only after manual success", () => {
    const s = session();
    noteCodexResultForAutoPause(s, result({ uuid: "r1" }), turn("automatic"), 100);
    noteCodexResultForAutoPause(s, result({ uuid: "r2" }), turn("automatic"), 200);
    noteCodexResultForAutoPause(s, result({ uuid: "r3" }), turn("automatic"), 300);

    const failedManual = noteCodexResultForAutoPause(s, result({ uuid: "r4" }), turn("manual"), 400);
    expect(failedManual.pausedNow).toBe(false);
    expect(s.state.codex_result_error_auto_pause?.pausedAt).toBe(300);
    expect(s.state.codex_result_error_auto_pause?.streak).toBe(4);

    queueCodexAutoPausedInput(s, "programmatic", {
      type: "user_message",
      content: "held herd event",
      agentSource: { sessionId: "herd-events" },
    });
    const resumed = noteCodexResultForAutoPause(
      s,
      result({ is_error: false, result: "ok", subtype: "success", stop_reason: "end_turn" }),
      turn("manual"),
      500,
    );

    expect(resumed.resumedNow).toBe(true);
    expect(resumed.heldInputs).toHaveLength(1);
    expect(s.state.codex_result_error_auto_pause).toBeNull();
  });

  it("coalesces repeated automatic held inputs and materializes one representative on drain", () => {
    const s = session();
    noteCodexResultForAutoPause(s, result({ uuid: "r1" }), turn("automatic"), 100);
    noteCodexResultForAutoPause(s, result({ uuid: "r2" }), turn("automatic"), 200);
    noteCodexResultForAutoPause(s, result({ uuid: "r3" }), turn("automatic"), 300);
    const message = {
      type: "user_message" as const,
      content: "board stalled",
      agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      threadKey: "main",
    };

    queueCodexAutoPausedInput(s, "programmatic", message, 400);
    queueCodexAutoPausedInput(s, "programmatic", message, 500);

    const state = s.state.codex_result_error_auto_pause!;
    expect(state.heldInputs).toHaveLength(1);
    expect(getCodexAutoPauseHeldInputCount(state)).toBe(2);
    expect(materializeCodexAutoPausedInputsForDrain(state.heldInputs)[0]?.content).toContain("2 similar automatic");
  });

  it("treats only composer and explicit manual overrides as manual while background sources are automatic", () => {
    expect(determineUserMessageSourceKind({ type: "user_message", content: "hi", inputSource: "composer" })).toBe(
      "manual",
    );
    expect(
      determineUserMessageSourceKind({
        type: "user_message",
        content: "from takode send",
        autoPauseSourceKind: "manual",
        agentSource: { sessionId: "operator-session" },
      }),
    ).toBe("manual");
    expect(
      determineUserMessageSourceKind({
        type: "user_message",
        content: "internal",
        agentSource: { sessionId: "resource-lease:agent-browser" },
      }),
    ).toBe("automatic");
    expect(
      determineUserMessageSourceKind({
        type: "user_message",
        content: "herd",
        agentSource: { sessionId: "herd-events" },
      }),
    ).toBe("automatic");
    expect(
      determineUserMessageSourceKind({
        type: "user_message",
        content: "timer",
        agentSource: { sessionId: "timer:abc" },
      }),
    ).toBe("automatic");
    expect(
      determineUserMessageSourceKind({ type: "user_message", content: "internal", inputSource: "programmatic" }),
    ).toBe("automatic");
  });

  it("marks a batched Codex turn automatic when any pending input is automatic", () => {
    const manual: PendingCodexInput = {
      id: "m1",
      content: "manual",
      timestamp: 1,
      cancelable: true,
      autoPauseSourceKind: "manual",
    };
    const automatic: PendingCodexInput = {
      id: "a1",
      content: "automatic",
      timestamp: 2,
      cancelable: true,
      agentSource: { sessionId: "herd-events" },
    };

    expect(determineCodexTurnSourceKind([manual])).toBe("manual");
    expect(determineCodexTurnSourceKind([manual, automatic])).toBe("automatic");
  });
});
