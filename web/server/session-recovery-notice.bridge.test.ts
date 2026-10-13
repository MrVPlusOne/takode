import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
// The memory catalog a fresh conversation gets is not what these tests check.
vi.mock("./memory-catalog-injection.js", () => ({ buildMemoryCatalogInjectionBundle: async () => null }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { SESSION_RECOVERY_SOURCE, type SessionRecoveryFacts } from "./session-recovery-notice.js";
import { WsBridge } from "./ws-bridge.js";

// A session whose worktree or conversation Takode had to rebuild (its host moved
// to a new machine, say) must hear what was kept and lost before anything else,
// including messages that were already waiting for it. These tests drive the
// real bridge with a launcher stand-in that holds the rebuilt facts.

const LEADER = { sessionId: "leader-1", sessionLabel: "#1 Leader" };
const CHECKOUT = { oldCwd: "/gone/main-wt-1", cwd: "/kept/main-wt-1", branch: "main-wt-1", ownBranchKept: true };
let bridge: WsBridge;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "session-recovery-bridge-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Launcher stand-in: the session's record, with what its agent still has to be told. */
function useLauncher(info: { sessionId: string; cliSessionId?: string; pendingRecovery?: SessionRecoveryFacts }) {
  const record = { state: "connected", backendType: "claude-sdk", ...info };
  bridge.launcher = {
    touchActivity: vi.fn(),
    touchUserMessage: vi.fn(),
    setCLISessionId: vi.fn(),
    getSession: vi.fn(() => record),
    takeRecovery: vi.fn(() => {
      const facts = record.pendingRecovery;
      delete record.pendingRecovery;
      return facts;
    }),
  } as any;
  return record;
}

describe("telling a relaunched session what Takode rebuilt", () => {
  it("Claude: the notice reaches a resumed process before messages queued for it", async () => {
    vi.useFakeTimers();
    const session = bridge.getOrCreateSession("s1", "claude-sdk");
    session.messageHistory.push({ type: "assistant", message: { id: "earlier", content: [] } } as any);
    const record = useLauncher({ sessionId: "s1", cliSessionId: "kept", pendingRecovery: { checkout: CHECKOUT } });

    bridge.injectUserMessage("s1", "queued before the relaunch", LEADER);
    const backend = createClaudeSdkTestBackend("s1").attach(bridge);
    // Sent during the resume window, while the notice is still owed: it waits too.
    bridge.injectUserMessage("s1", "sent while resuming", LEADER);
    expect(backend.promptTexts()).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_500);
    const prompts = backend.promptTexts();
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain(CHECKOUT.oldCwd);
    expect(prompts[0]).toContain(CHECKOUT.cwd);
    expect(prompts[1]).toContain("queued before the relaunch");
    expect(prompts[2]).toContain("sent while resuming");
    expect(record.pendingRecovery).toBeUndefined();
    // Afterwards input flows straight through again.
    expect(bridge.injectUserMessage("s1", "next", LEADER)).toBe("sent");
  });

  it("Claude: a lost conversation starts fresh after a recycle boundary, with the notice first", async () => {
    const session = bridge.getOrCreateSession("s2", "claude-sdk");
    session.messageHistory.push({ type: "assistant", message: { id: "earlier", content: [] } } as any);
    useLauncher({ sessionId: "s2", pendingRecovery: { checkout: CHECKOUT, conversationLost: true } });

    bridge.injectUserMessage("s2", "waiting for the fresh agent", LEADER);
    const backend = createClaudeSdkTestBackend("s2").attach(bridge);
    // The fresh conversation's context is built asynchronously; the queued message waits for it.
    await vi.waitFor(() => expect(backend.promptTexts()).toHaveLength(2));

    const [notice, queued] = backend.promptTexts();
    expect(notice).toContain(CHECKOUT.cwd);
    expect(notice).toContain("takode scan s2");
    expect(queued).toContain("waiting for the fresh agent");

    // History shows the boundary, then the notice from System, ahead of the delivered message.
    const markerIndex = session.messageHistory.findIndex(
      (entry) => entry.type === "compact_marker" && entry.markerKind === "session_recycled",
    );
    const noticeIndex = session.messageHistory.findIndex(
      (entry) => entry.type === "user_message" && entry.agentSource?.sessionId === SESSION_RECOVERY_SOURCE.sessionId,
    );
    expect(markerIndex).toBeGreaterThan(0);
    expect(noticeIndex).toBeGreaterThan(markerIndex);
  });

  it("Claude: nothing is injected when nothing was rebuilt", () => {
    bridge.getOrCreateSession("s3", "claude-sdk");
    useLauncher({ sessionId: "s3" });
    bridge.injectUserMessage("s3", "plain message", LEADER);
    const backend = createClaudeSdkTestBackend("s3").attach(bridge);
    expect(backend.promptTexts()).toHaveLength(1);
    expect(backend.promptTexts()[0]).toContain("plain message");
  });

  it("Codex: a thread missing from the machine is reported first, ahead of queued input", () => {
    const session = bridge.getOrCreateSession("s4", "codex");
    session.messageHistory.push({ type: "assistant", message: { id: "earlier", content: [] } } as any);
    const record = useLauncher({ sessionId: "s4" });
    record.backendType = "codex";
    (bridge.launcher as any).noteRecovery = vi.fn((_id: string, facts: SessionRecoveryFacts) => {
      record.pendingRecovery = { ...record.pendingRecovery, ...facts };
    });

    bridge.injectUserMessage("s4", "queued for codex", LEADER);
    const adapter = makeCodexAdapter();
    bridge.attachCodexAdapter("s4", adapter as any);
    adapter.emitSessionMeta({ cliSessionId: "fresh-thread", resumedThreadMissing: true });

    expect((bridge.launcher as any).noteRecovery).toHaveBeenCalledWith("s4", { conversationLost: true });
    const batches = adapter.sendBrowserMessage.mock.calls
      .map(([msg]) => msg)
      .filter((msg: any) => msg.type === "codex_start_pending");
    expect(batches).toHaveLength(1);
    const texts = batches[0].inputs.map((input: { content: string }) => input.content);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("previous conversation");
    expect(texts[1]).toContain("queued for codex");
  });
});

/** Connected Codex adapter whose session start the test reports itself. */
function makeCodexAdapter() {
  const noop = () => {};
  let sessionMeta: (meta: unknown) => void = noop;
  return {
    onBrowserMessage: noop,
    onSessionMeta: (cb: (meta: unknown) => void) => {
      sessionMeta = cb;
    },
    emitSessionMeta: (meta: unknown) => sessionMeta(meta),
    onDisconnect: noop,
    onInitError: noop,
    onTurnStartFailed: noop,
    onTurnStarted: noop,
    onTurnSteered: noop,
    onTurnSteerFailed: noop,
    sendBrowserMessage: vi.fn((_msg: any) => true),
    rollbackTurns: vi.fn(async () => {}),
    isConnected: () => true,
    disconnect: vi.fn(async () => {}),
    getThreadId: () => "fresh-thread",
    getCurrentTurnId: () => null,
  };
}
