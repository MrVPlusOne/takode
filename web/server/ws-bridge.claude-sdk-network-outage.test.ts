import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

// The resume waits for a usable network interface; tests switch it on and off.
const network = vi.hoisted(() => ({ online: true }));
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    networkInterfaces: () =>
      network.online
        ? { en0: [{ address: "192.168.1.20", internal: false, family: "IPv4" }] }
        : {
            lo0: [{ address: "127.0.0.1", internal: true, family: "IPv4" }],
            en0: [{ address: "fe80::1", internal: false, family: "IPv6" }],
          },
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_NETWORK_RESUME_PROMPT } from "./bridge/claude-network-wait.js";
import { buildPersistedSessionPayload } from "./bridge/session-registry-controller.js";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// When the laptop loses its connection, Claude retries the model request and
// finally ends the turn with a synthetic "API Error: Can't reach the API
// server" message and an error result (no HTTP status). Takode must keep the
// turn running as "waiting for connection", keep the error out of the feed and
// herd events, and resume the turn by itself once the network is back.

const NETWORK_ERROR = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";

// Shapes recorded from Claude Code 2.1.289 during the October 7 outage.
const API_RETRY = JSON.stringify({
  type: "system",
  subtype: "api_retry",
  attempt: 1,
  max_retries: 10,
  retry_delay_ms: 500,
  error_status: null,
  error: "unknown",
  uuid: "retry-1",
  session_id: "cli-s1",
});

function syntheticErrorAssistant(text: string, uuid: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      id: `${uuid}-message`,
      type: "message",
      role: "assistant",
      model: "<synthetic>",
      content: [{ type: "text", text }],
      stop_reason: "stop_sequence",
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    parent_tool_use_id: null,
    session_id: "cli-s1",
    uuid,
  });
}

function errorResult(text: string, uuid: string, apiErrorStatus: number | null = null): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    result: text,
    api_error_status: apiErrorStatus,
    terminal_reason: "api_error",
    stop_reason: "stop_sequence",
    duration_ms: 10,
    duration_api_ms: 10,
    num_turns: 0,
    total_cost_usd: 0,
    session_id: "cli-s1",
    uuid,
  });
}

const ASSISTANT = JSON.stringify({
  type: "assistant",
  message: {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5.5",
    content: [{ type: "text", text: "Picking up where I left off." }],
    stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  parent_tool_use_id: null,
  session_id: "cli-s1",
  uuid: "assistant-1",
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
  network.online = true;
  tempDir = mkdtempSync(join(tmpdir(), "claude-sdk-network-outage-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
});

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  // Let debounced session saves finish before their directory disappears.
  await bridge.store!.flushAll();
  rmSync(tempDir, { recursive: true, force: true });
});

function startTurn() {
  const session = bridge.getOrCreateSession("s1", "claude-sdk");
  const backend = createClaudeSdkTestBackend("s1").attach(bridge);
  const browserSends: any[] = [];
  vi.spyOn(bridge as any, "broadcastToBrowsers").mockImplementation((...args: unknown[]) => {
    browserSends.push(args[1]);
  });
  bridge.injectUserMessage("s1", "do the work");
  backend.clearSent();
  return { session, backend, browserSends };
}

function historyText(sessionId: string): string {
  return JSON.stringify(bridge.getSession(sessionId)!.messageHistory);
}

describe("Claude SDK turns during a network outage", () => {
  it("waits for the connection without showing an error, then resumes the turn once", () => {
    const { session, backend, browserSends } = startTurn();

    // Claude's own retries put the session into the waiting state right away.
    backend.message(API_RETRY);
    expect(session.state.claude_network_wait).toEqual({ since: expect.any(Number) });
    expect(browserSends).toContainEqual({
      type: "session_update",
      session: { claude_network_wait: session.state.claude_network_wait },
    });

    // Claude gives up while the machine is still offline.
    network.online = false;
    backend.message(syntheticErrorAssistant(NETWORK_ERROR, "synthetic-1"));
    backend.message(errorResult(NETWORK_ERROR, "result-err-1"));
    expect(session.isGenerating).toBe(true);
    expect(historyText("s1")).not.toContain("Can't reach");
    expect(JSON.stringify(browserSends)).not.toContain("Can't reach");

    // No attempt while there is no usable network at all.
    vi.advanceTimersByTime(60_000);
    expect(backend.promptTexts()).toEqual([]);

    // Once a connection is back, the interrupted turn continues with one hidden prompt.
    network.online = true;
    vi.advanceTimersByTime(5_000);
    expect(backend.promptTexts()).toEqual([CLAUDE_NETWORK_RESUME_PROMPT]);
    vi.advanceTimersByTime(120_000);
    expect(backend.promptTexts()).toHaveLength(1);

    backend.message(ASSISTANT);
    expect(session.state.claude_network_wait).toBeNull();
    expect(browserSends).toContainEqual({ type: "session_update", session: { claude_network_wait: null } });
    backend.message(SUCCESS);
    expect(session.isGenerating).toBe(false);

    // The feed reads as if the outage never happened: no error, no resume prompt.
    const history = historyText("s1");
    expect(history).not.toContain("Can't reach");
    expect(history).not.toContain(CLAUDE_NETWORK_RESUME_PROMPT);
    expect(history).toContain("Picking up where I left off.");
  });

  it("backs off when a resume attempt fails again", () => {
    const { session, backend } = startTurn();
    backend.message(errorResult(NETWORK_ERROR, "result-err-1"));
    vi.advanceTimersByTime(10_000);
    expect(backend.promptTexts()).toHaveLength(1);

    // The resumed request fails too: the next attempt waits longer.
    backend.message(errorResult(NETWORK_ERROR, "result-err-2"));
    vi.advanceTimersByTime(29_000);
    expect(backend.promptTexts()).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(backend.promptTexts()).toHaveLength(2);
    expect(session.isGenerating).toBe(true);
  });

  it("lets other input resume Claude instead of sending a second prompt", () => {
    const { backend } = startTurn();
    backend.message(errorResult(NETWORK_ERROR, "result-err-1"));

    bridge.injectUserMessage("s1", "status?");
    expect(backend.promptTexts()).toEqual([expect.stringContaining("status?")]);
    vi.advanceTimersByTime(60_000);
    expect(backend.promptTexts()).toEqual([expect.stringContaining("status?")]);
  });

  it("stops waiting when the turn is interrupted", async () => {
    const { session, backend } = startTurn();
    backend.message(errorResult(NETWORK_ERROR, "result-err-1"));

    await bridge.interruptSession("s1", "user");

    expect(session.isGenerating).toBe(false);
    expect(session.state.claude_network_wait).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(backend.promptTexts()).toEqual([]);
  });

  it("keeps genuine API errors visible and ends the turn", () => {
    // An HTTP status means the API answered: authentication, quota or a bad request.
    const { session, backend } = startTurn();
    const authError = "API Error: 401 authentication failed";
    backend.message(syntheticErrorAssistant(authError, "synthetic-auth"));
    backend.message(errorResult(authError, "result-auth", 401));

    expect(session.isGenerating).toBe(false);
    expect(session.state.claude_network_wait ?? null).toBeNull();
    expect(historyText("s1")).toContain(authError);
    vi.advanceTimersByTime(60_000);
    expect(backend.promptTexts()).toEqual([]);
  });

  it("does not persist the waiting state", () => {
    // The resume timer lives in this server process; a restored session must not show a stale wait.
    const { session, backend } = startTurn();
    backend.message(API_RETRY);
    expect(session.state.claude_network_wait).not.toBeNull();
    expect(buildPersistedSessionPayload(session as any).state).not.toHaveProperty("claude_network_wait");
  });
});
