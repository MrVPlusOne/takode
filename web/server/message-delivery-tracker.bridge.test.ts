import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { createMessageDeliveryProbe } from "./message-delivery-tracker.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// The delivery probe reads real bridge state, so these tests drive the real
// bridge: a leader's message to a session without a running backend is queued,
// and the probe must call it delivered only once the backend actually took it.

const LEADER = { sessionId: "leader-1", sessionLabel: "#1 Leader" };
let bridge: WsBridge;
let tempDir: string;
let launcherState: "starting" | "connected" | "exited";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "message-delivery-bridge-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
  launcherState = "starting";
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tempDir, { recursive: true, force: true });
});

function probe(sessionId: string) {
  return createMessageDeliveryProbe({
    getLauncherSession: () => ({ state: launcherState }),
    getBridgeSession: (id) => bridge.getSession(id),
    hostIsOnline: () => true,
    hostName: async (hostId) => hostId,
  })(sessionId, LEADER.sessionId);
}

describe("message delivery against the bridge", () => {
  it("Claude: queued while no process runs, delivered once the process takes it", async () => {
    bridge.getOrCreateSession("s1", "claude-sdk");
    expect(bridge.injectUserMessage("s1", "take over the handover", LEADER)).toBe("queued");
    expect(await probe("s1")).toMatchObject({ kind: "waiting", wait: "starting" });

    launcherState = "exited";
    expect(await probe("s1")).toMatchObject({ kind: "waiting", wait: "stopped" });

    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    expect(backend.promptTexts().join("\n")).toContain("take over the handover");
    expect(await probe("s1")).toEqual({ kind: "delivered" });
  });

  it("Claude: a resumed process is not delivered until its replay window flushes the input", async () => {
    vi.useFakeTimers();
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    session.messageHistory.push({ type: "assistant", message: { id: "earlier", content: [] } } as any);
    bridge.launcher = {
      touchActivity: vi.fn(),
      touchUserMessage: vi.fn(),
      getSession: vi.fn(() => ({ sessionId: "s1", state: "connected", backendType: "claude-sdk", cliSessionId: "c" })),
      setCLISessionId: vi.fn(),
    } as any;
    bridge.injectUserMessage("s1", "continue the work", LEADER);
    createClaudeSdkTestBackend("s1").attach(bridge);
    expect(session.cliResuming).toBe(true);
    expect(await probe("s1")).toMatchObject({ kind: "waiting" });

    await vi.advanceTimersByTimeAsync(2_500);
    expect(session.pendingMessages).toEqual([]);
    expect(await probe("s1")).toEqual({ kind: "delivered" });
  });

  it("Codex: queued without an adapter, delivered once a connected adapter is attached", async () => {
    bridge.getOrCreateSession("s2", "codex");
    expect(bridge.injectUserMessage("s2", "review the diff", LEADER)).toBe("queued");
    expect(await probe("s2")).toMatchObject({ kind: "waiting" });

    bridge.attachCodexAdapter("s2", makeConnectedCodexAdapter() as any);
    expect(await probe("s2")).toEqual({ kind: "delivered" });
  });
});

/** Minimal connected Codex adapter: the bridge registers callbacks and dispatches pending input to it. */
function makeConnectedCodexAdapter() {
  const noop = () => {};
  return {
    onBrowserMessage: noop,
    onSessionMeta: noop,
    onDisconnect: noop,
    onInitError: noop,
    onTurnStartFailed: noop,
    onTurnStarted: noop,
    onTurnSteered: noop,
    onTurnSteerFailed: noop,
    sendBrowserMessage: vi.fn(() => true),
    rollbackTurns: vi.fn(async () => {}),
    isConnected: () => true,
    disconnect: vi.fn(async () => {}),
    getThreadId: () => "thread-1",
    getCurrentTurnId: () => null,
  };
}
