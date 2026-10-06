import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// An interrupt must end a Claude SDK turn even when Claude never received the
// turn's input. Claude only answers an interrupt with a result while it runs a
// turn, so a session marked running for input that is still queued would
// otherwise stay "running" until stuck-session recovery. Interrupting cancels
// that undelivered input; its history entry stays visible as sent.

const RESULT = JSON.stringify({
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
  uuid: "result-1",
});

const ASSISTANT = JSON.stringify({
  type: "assistant",
  message: {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5.5",
    content: [{ type: "text", text: "Working on it." }],
    stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  parent_tool_use_id: null,
  session_id: "cli-s1",
  uuid: "assistant-1",
});

let bridge: WsBridge;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-sdk-interrupt-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  rmSync(tempDir, { recursive: true, force: true });
});

function userMessagesIn(sessionId: string): string[] {
  return bridge
    .getSession(sessionId)!
    .messageHistory.filter((entry: any) => entry.type === "user_message")
    .map((entry: any) => entry.content);
}

/** A resumed session: saved history plus the Claude conversation ID to resume. */
function makeResumedSession(sessionId: string) {
  const session = bridge.getOrCreateSession(sessionId, "claude-sdk");
  session.messageHistory.push({ type: "assistant", message: { id: "earlier", content: [] } } as any);
  bridge.launcher = {
    touchActivity: vi.fn(),
    touchUserMessage: vi.fn(),
    getSession: vi.fn(() => ({ sessionId, state: "connected", backendType: "claude-sdk", cliSessionId: "cli-s1" })),
    setCLISessionId: vi.fn(),
  } as any;
  return session;
}

describe("interrupting a Claude SDK turn", () => {
  it("ends a turn whose input is still queued for a process that is not running", async () => {
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    expect(bridge.injectUserMessage("s1", "do the work")).toBe("queued");
    expect(session.isGenerating).toBe(true);

    await bridge.interruptSession("s1", "leader");

    expect(session.isGenerating).toBe(false);
    expect(session.pendingMessages).toEqual([]);
    expect(userMessagesIn("s1")).toEqual(["do the work"]);

    // The cancelled input never reaches the process once it starts.
    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    expect(backend.promptTexts()).toEqual([]);
    expect(backend.query.interrupt).not.toHaveBeenCalled();
  });

  it("ends the turn and cancels input held while a resumed process settles", async () => {
    vi.useFakeTimers();
    const session = makeResumedSession("s1");
    bridge.injectUserMessage("s1", "Continue.");
    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    expect(session.cliResuming).toBe(true);
    expect(session.pendingMessages).toHaveLength(1);

    await bridge.interruptSession("s1", "user");

    expect(session.isGenerating).toBe(false);
    expect(session.pendingMessages).toEqual([]);
    vi.advanceTimersByTime(2100);
    expect(backend.promptTexts()).toEqual([]);
    expect(userMessagesIn("s1")).toEqual(["Continue."]);
  });

  it("cancels input the adapter holds until its process starts", async () => {
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    (backend.adapter as any).connected = false;
    bridge.injectUserMessage("s1", "do the work");
    expect(session.isGenerating).toBe(true);

    await bridge.interruptSession("s1", "user");

    expect(session.isGenerating).toBe(false);
    expect(backend.adapter.drainPendingOutgoing()).toEqual([]);
    expect(backend.query.interrupt).not.toHaveBeenCalled();
  });

  it("waits for Claude's result when Claude is running the turn", async () => {
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    bridge.injectUserMessage("s1", "do the work");
    expect(backend.promptTexts()).toHaveLength(1);
    // Output during the turn does not end it; only Claude's result does.
    backend.message(ASSISTANT);
    expect(backend.adapter.hasTurnInFlight()).toBe(true);

    await bridge.interruptSession("s1", "user");

    expect(backend.query.interrupt).toHaveBeenCalledTimes(1);
    expect(session.isGenerating).toBe(true);

    backend.message(RESULT);
    expect(backend.adapter.hasTurnInFlight()).toBe(false);
    expect(session.isGenerating).toBe(false);
  });

  it("keeps queued input for the resume after a restart-prep interrupt", async () => {
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    bridge.injectUserMessage("s1", "do the work");

    await bridge.interruptSession("s1", "user", { interruptOrigin: "restart_prep", restartPrepOperationId: "op-1" });

    // The turn ends so the restart can proceed, but the input is delivered afterwards.
    expect(session.isGenerating).toBe(false);
    expect(session.pendingMessages).toHaveLength(1);
  });
});
