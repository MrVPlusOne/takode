import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { configureRemoteMachines } from "../remote-host/session-machine.js";
import { runWsBridgeStuckSessionWatchdogSweep } from "./stuck-session-watchdog-controller.js";
import type { Session } from "./ws-bridge-session.js";

function idleSession(id: string, hostId?: string): Session {
  return {
    id,
    backendType: "claude-sdk",
    isGenerating: false,
    pendingCodexInputs: [],
    pendingMessages: [],
    state: { ...(hostId ? { host_id: hostId } : {}) },
  } as unknown as Session;
}

describe("stuck session watchdog", () => {
  afterEach(() => configureRemoteMachines(null));

  // A session on an offline host is waiting for that host; the watchdog must not
  // judge (and possibly interrupt) its turn until the host is back.
  it("skips sessions whose remote host is offline", () => {
    configureRemoteMachines(new HostLinkManager());
    const inspected: string[] = [];
    runWsBridgeStuckSessionWatchdogSweep({
      sessions: [idleSession("local"), idleSession("remote", "host-1")],
      now: Date.now(),
      launcher: {
        getSession: (sessionId) => {
          inspected.push(sessionId);
          return undefined;
        },
      },
      requestCodexAutoRecovery: () => false,
      broadcastToBrowsers: () => {},
      persistSession: () => {},
      setAttentionError: () => {},
      markTurnInterrupted: () => {},
      setGenerating: () => {},
      emitTakodeTurnEnd: () => {},
      buildTurnToolSummary: () => ({}) as never,
    });
    expect(inspected).toEqual(["local"]);
  });
});
