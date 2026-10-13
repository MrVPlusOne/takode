import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { flushHeldSdkMessages } from "./bridge/claude-sdk-adapter-lifecycle-controller.js";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";
import type { HostLinkManager } from "./remote-host/host-link-manager.js";
import { configureRemoteMachines } from "./remote-host/session-machine.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// A leader whose own host is offline still has a connected-looking Claude
// backend, so herd events are injected into it and the bridge holds them until
// the host is back. Each injection briefly marks the leader running; when that
// optimistic state lapses the dispatcher looks again, and it must recognize the
// held copy instead of holding the same event again (on October 13 one
// host_offline event was held 25 times during a 12-minute laptop outage).

let bridge: WsBridge;
let tempDir: string;

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
});

afterEach(() => {
  configureRemoteMachines(null);
  vi.useRealTimers();
  rmSync(tempDir, { recursive: true, force: true });
});

it("holds a herd event for a leader on an offline host once, and delivers it once the host is back", async () => {
  let hostOnline = false;
  configureRemoteMachines({ status: () => ({ online: hostOnline }) } as unknown as HostLinkManager);
  const leader = bridge.getOrCreateSession("leader", "claude-sdk");
  leader.state.host_id = "laptop";
  const backend = createClaudeSdkTestBackend("leader").attach(bridge);
  leader.cliInitReceived = true;
  const dispatcher = new HerdEventDispatcher(bridge, { getHerdedSessions: () => [], getSession: () => undefined });
  bridge.herdEventDispatcher = dispatcher;

  dispatcher.emitTakodeEventForOrchestrator("leader", "leader", "host_offline", {
    hostId: "condor",
    hostName: "condor",
    offlineSince: Date.now() - 2 * 60_000,
    sessions: [{ sessionId: "worker", sessionNum: 7, reasons: ["mid-turn"] }],
  });
  await vi.advanceTimersByTimeAsync(5 * 60_000);

  const held = leader.pendingMessages.filter((raw) => raw.includes("host_offline"));
  expect(held).toHaveLength(1);

  hostOnline = true;
  flushHeldSdkMessages(leader);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(backend.promptTexts().filter((text) => text.includes("host_offline"))).toHaveLength(1);
  expect(dispatcher.getDiagnostics("leader").pendingEventCount).toBe(0);
  dispatcher.destroy();
});
