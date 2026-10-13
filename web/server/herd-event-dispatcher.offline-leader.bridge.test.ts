import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";
import type { HostLinkManager } from "./remote-host/host-link-manager.js";
import { configureRemoteMachines } from "./remote-host/session-machine.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// A leader whose own host is offline still has a connected-looking Claude
// backend. Herd events injected into it were held by the bridge, marked it
// running for 30 s, and were injected again when that lapsed (on October 13 one
// host_offline event was held 25 times during a 12-minute laptop outage). Now
// the dispatcher keeps events for such a leader until its host is back and
// delivers each once, whatever its kind.

let bridge: WsBridge;
let tempDir: string;
let hostOnline: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  tempDir = mkdtempSync(join(tmpdir(), "herd-offline-leader-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
  bridge.launcher = {
    touchActivity: vi.fn(),
    touchUserMessage: vi.fn(),
    getSession: vi.fn((sessionId: string) => ({
      sessionId,
      state: "connected",
      backendType: "claude-sdk",
      cliSessionId: "cli-leader",
      isOrchestrator: true,
    })),
    setCLISessionId: vi.fn(),
  } as any;
  hostOnline = false;
  configureRemoteMachines({ status: () => ({ online: hostOnline }) } as unknown as HostLinkManager);
});

afterEach(() => {
  configureRemoteMachines(null);
  vi.useRealTimers();
  rmSync(tempDir, { recursive: true, force: true });
});

it("keeps herd events for a leader on an offline host and delivers each once when the host is back", async () => {
  const leader = bridge.getOrCreateSession("leader", "claude-sdk");
  leader.state.host_id = "laptop";
  const backend = createClaudeSdkTestBackend("leader").attach(bridge);
  leader.cliInitReceived = true;
  const dispatcher = new HerdEventDispatcher(
    bridge,
    { getHerdedSessions: () => [], getSession: () => undefined },
    { isHostOffline: () => !hostOnline },
  );
  bridge.herdEventDispatcher = dispatcher;

  // message_delivery has no stable herd key, so nothing could recognize a held copy of it.
  dispatcher.emitTakodeEventForOrchestrator("leader", "leader", "message_delivery", {
    messageId: "msg-1",
    status: "delivered",
    preview: "check the build",
    queuedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  // Input arriving for the leader (a human message, the stuck-turn watchdog) does not carry them in either.
  expect(dispatcher.forceFlushPendingEvents("leader")).toBe(0);

  expect(leader.pendingMessages).toEqual([]);
  expect(leader.isGenerating).toBe(false);
  expect(dispatcher.getDiagnostics("leader").pendingEventCount).toBe(1);

  hostOnline = true;
  dispatcher.onHostOnline("leader");
  // Past the delivery debounce, not the 30 s no-response timeout (this test backend never answers).
  await vi.advanceTimersByTimeAsync(1_000);
  expect(backend.promptTexts().filter((text) => text.includes("message_delivery"))).toHaveLength(1);
  expect(leader.pendingMessages).toEqual([]);
  dispatcher.destroy();
});
