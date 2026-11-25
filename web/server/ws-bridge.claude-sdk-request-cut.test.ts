import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_REQUEST_CUT_SOURCE } from "../shared/claude-request-cut.js";
import { CLAUDE_REQUEST_CUT_AFTER_MS } from "./bridge/claude-request-cut.js";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// GitHub Copilot ends every streamed response about 631 s after the request.
// Fable 5.2 at high effort sometimes thinks longer than that on one request,
// and Claude Code then retried the same request from scratch, cut again each
// time. Takode lowers the session's effort one level, cancels Claude Code's
// retry (which would resend the old effort) and continues the turn with a
// visible notice; the session's effort comes back when the turn ends.

const MESSAGE_START = JSON.stringify({
  type: "stream_event",
  event: { type: "message_start", message: { id: "msg-long" } },
  parent_tool_use_id: null,
  session_id: "cli-s1",
  uuid: "se-start",
});

/** Claude Code 2.1.311's retry notice after Copilot's cut: ECONNRESET, so no HTTP status. */
function connectionRetry(attempt = 1, status: number | null = null): string {
  return JSON.stringify({
    type: "system",
    subtype: "api_retry",
    attempt,
    max_retries: 15,
    retry_delay_ms: 600,
    error_status: status,
    error: "unknown",
    uuid: `retry-${attempt}`,
    session_id: "cli-s1",
  });
}

/** What Claude Code reports for the interrupt that cancels its retry. */
const ABORTED = JSON.stringify({
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  terminal_reason: "aborted_streaming",
  stop_reason: "tool_use",
  duration_ms: 640_000,
  duration_api_ms: 640_000,
  num_turns: 0,
  total_cost_usd: 0,
  session_id: "cli-s1",
  uuid: "result-aborted",
});

const SUCCESS = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  stop_reason: "end_turn",
  duration_ms: 10,
  duration_api_ms: 10,
  num_turns: 1,
  total_cost_usd: 0,
  session_id: "cli-s1",
  uuid: "result-ok",
});

let bridge: WsBridge;
let tempDir: string;

beforeEach(() => {
  vi.useFakeTimers();
  tempDir = mkdtempSync(join(tmpdir(), "claude-sdk-request-cut-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
});

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  await bridge.store!.flushAll();
  rmSync(tempDir, { recursive: true, force: true });
});

function startTurn(effort: string | null = null) {
  const session = bridge.getOrCreateSession("s1", "claude-sdk");
  session.state.claude_reasoning_effort = effort;
  const backend = createClaudeSdkTestBackend("s1").attach(bridge);
  vi.spyOn(bridge as any, "broadcastToBrowsers").mockImplementation(() => {});
  bridge.injectUserMessage("s1", "design the wallet");
  backend.clearSent();
  return { session, backend };
}

function effortChanges(backend: ReturnType<typeof startTurn>["backend"]): string[] {
  return backend.outgoing.filter((m) => m.type === "set_claude_reasoning_effort").map((m) => (m as any).effort);
}

function streamEvent(type: string): string {
  return JSON.stringify({
    type: "stream_event",
    event: { type },
    parent_tool_use_id: null,
    session_id: "cli-s1",
    uuid: `se-${type}`,
  });
}

/**
 * A request that streamed past the cut and failed without an HTTP status, in the order
 * Claude Code 2.1.311 reports it: it closes the cut response with a synthesized
 * message_stop (no message_delta) and then sends the retry notice.
 */
function cutRequest(backend: ReturnType<typeof startTurn>["backend"], attempt = 1) {
  backend.message(MESSAGE_START);
  vi.advanceTimersByTime(CLAUDE_REQUEST_CUT_AFTER_MS + 31_000);
  backend.message(streamEvent("content_block_stop"));
  backend.message(streamEvent("message_stop"));
  backend.message(connectionRetry(attempt));
}

describe("Claude requests cut after 10 minutes", () => {
  it("lowers effort one level, cancels Claude Code's retry and continues the turn with a visible notice", () => {
    const { session, backend } = startTurn();

    cutRequest(backend);

    // Default effort counts as high, Claude Code's default for these models.
    expect(effortChanges(backend)).toEqual(["medium"]);
    expect(backend.outgoing.map((m) => m.type)).toContain("interrupt");

    // The interrupt's result does not end the turn; the notice continues it.
    backend.message(ABORTED);
    expect(session.isGenerating).toBe(true);
    const notice = session.messageHistory.find(
      (m) => m.type === "user_message" && m.agentSource?.sessionId === CLAUDE_REQUEST_CUT_SOURCE.sessionId,
    );
    expect(notice).toBeTruthy();
    expect(backend.promptTexts().at(-1)).toContain("from high to medium");
    expect(session.state.claude_reasoning_effort).toBeNull();

    // When the turn ends, the session's own effort comes back.
    backend.message(SUCCESS);
    expect(session.isGenerating).toBe(false);
    expect(effortChanges(backend)).toEqual(["medium", ""]);
  });

  it("lowers further on a second cut in the same turn and restores the session's chosen effort", () => {
    const { backend } = startTurn("xhigh");
    cutRequest(backend);
    backend.message(ABORTED);
    cutRequest(backend, 2);
    backend.message(ABORTED);
    backend.message(SUCCESS);

    expect(effortChanges(backend)).toEqual(["high", "medium", "xhigh"]);
  });

  it("starts from the effort the session launched with when it was never changed live", () => {
    // Takode records a live effort change in session state; until then the session runs at
    // its launch effort, which the launcher keeps.
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    vi.spyOn(bridge as any, "broadcastToBrowsers").mockImplementation(() => {});
    bridge.injectUserMessage("s1", "design the wallet");
    backend.clearSent();
    expect(session.isGenerating).toBe(true);
    bridge.launcher = { getSession: vi.fn(() => ({ claudeReasoningEffort: "max" })), touchActivity: vi.fn() } as any;
    delete (session.state as { claude_reasoning_effort?: unknown }).claude_reasoning_effort;

    cutRequest(backend);
    expect(backend.outgoing.map((m) => m.type)).toContain("interrupt");
    backend.message(ABORTED);
    backend.message(SUCCESS);

    expect(effortChanges(backend)).toEqual(["xhigh", "max"]);
  });

  it("leaves Claude Code's own retry alone for short requests, HTTP errors and the lowest effort", () => {
    // A short request that failed is a network problem or a server error, not the cut.
    const short = startTurn();
    short.backend.message(MESSAGE_START);
    vi.advanceTimersByTime(30_000);
    short.backend.message(connectionRetry());
    short.backend.message(MESSAGE_START);
    vi.advanceTimersByTime(CLAUDE_REQUEST_CUT_AFTER_MS + 31_000);
    short.backend.message(connectionRetry(2, 529));
    expect(effortChanges(short.backend)).toEqual([]);
    expect(short.backend.outgoing.map((m) => m.type)).not.toContain("interrupt");
    short.backend.message(SUCCESS);

    // A response that finished long ago does not make a later quick failure look like a cut.
    short.backend.message(MESSAGE_START);
    short.backend.message(streamEvent("message_delta"));
    short.backend.message(streamEvent("message_stop"));
    vi.advanceTimersByTime(CLAUDE_REQUEST_CUT_AFTER_MS + 31_000);
    short.backend.message(connectionRetry(3));
    expect(effortChanges(short.backend)).toEqual([]);

    // At low effort there is nothing to lower, so Claude Code keeps retrying.
    bridge.getSession("s1")!.state.claude_reasoning_effort = "low";
    bridge.injectUserMessage("s1", "again");
    short.backend.clearSent();
    cutRequest(short.backend);
    expect(effortChanges(short.backend)).toEqual([]);
    expect(short.backend.outgoing.map((m) => m.type)).not.toContain("interrupt");
  });
});
