import type { BridgeTurnView } from "./host-restart-gate.js";
import { HostUpdateSessions, type HostUpdateSession, type HostUpdateSessionsDeps } from "./host-update-sessions.js";

const STARTED_AT = 1_000;
const idle = (): BridgeTurnView => ({ isGenerating: false, pendingPermissions: { size: 0 }, messageHistory: [] });

/**
 * The session side of a host update: what it waits for, and, right after the
 * user's Restart Server, interrupting turns on the host, stopping its
 * sessions and continuing the interrupted ones once the host is back.
 */
describe("HostUpdateSessions", () => {
  let sessions: HostUpdateSession[];
  let bridges: Map<string, BridgeTurnView>;
  let landing: boolean;
  let reattaching: Set<string>;
  let events: string[];
  let held: Parameters<HostUpdateSessionsDeps["holdHerdEvents"]>[0][];

  function create(overrides: Partial<HostUpdateSessionsDeps> = {}): HostUpdateSessions {
    return new HostUpdateSessions({
      sessions: () => sessions,
      awaitingReattach: (sessionId) => reattaching.has(sessionId),
      bridgeSession: (sessionId) => bridges.get(sessionId),
      coordinatorStartedAt: STARTED_AT,
      landingRunOn: (hostId) => landing && hostId === "h1",
      // An interrupt ends the turn, as Restart Server's does.
      interrupt: async (sessionId, operationId) => {
        events.push(`interrupt ${sessionId} ${operationId.startsWith("host-update:h1:")}`);
        bridges.get(sessionId)!.isGenerating = false;
      },
      holdHerdEvents: (operation) => held.push(operation),
      stopSessions: async (hostId) => void events.push(`stop ${hostId}`),
      continueSession: (sessionId) => void events.push(`continue ${sessionId}`),
      interruptTimeoutMs: 300,
      sleep: async () => {},
      ...overrides,
    });
  }

  beforeEach(() => {
    sessions = [
      { sessionId: "leader", hostId: "h1", state: "connected", isOrchestrator: true },
      { sessionId: "busy", hostId: "h1", state: "connected", herdedBy: "leader" },
      { sessionId: "asking", hostId: "h1", state: "connected", herdedBy: "leader" },
      { sessionId: "quiet", hostId: "h1", state: "connected" },
      // Not on this host, archived or without a process: never touched.
      { sessionId: "elsewhere", hostId: "h2", state: "connected" },
      { sessionId: "archived", hostId: "h1", state: "connected", archived: true },
      { sessionId: "exited", hostId: "h1", state: "exited" },
    ];
    bridges = new Map(sessions.map((session) => [session.sessionId, idle()]));
    bridges.get("busy")!.isGenerating = true;
    bridges.get("asking")!.pendingPermissions = { size: 1 };
    bridges.get("elsewhere")!.isGenerating = true;
    bridges.get("exited")!.isGenerating = true;
    landing = false;
    reattaching = new Set();
    events = [];
    held = [];
  });

  // An update never cuts off a landing run or a takeover in progress; only an
  // update that is not immediate waits for turns to end.
  it("says what the update waits for", () => {
    const updates = create();
    expect(updates.blocker("h1", "when_idle")).toBe("its sessions finish their turns");
    expect(updates.blocker("h1", "immediate")).toBeNull();

    reattaching.add("quiet");
    expect(updates.blocker("h1", "immediate")).toBe("its sessions are taken over");
    landing = true;
    expect(updates.blocker("h1", "immediate")).toBe("the landing run there finishes");
    expect(updates.blocker("h2", "immediate")).toBeNull();

    landing = false;
    reattaching.clear();
    bridges.get("busy")!.isGenerating = false;
    bridges.get("asking")!.pendingPermissions = { size: 0 };
    expect(updates.blocker("h1", "when_idle")).toBeNull();
  });

  // Before an update that waited for idle, the sessions are only stopped.
  it("only stops the sessions before an update that waited for idle", async () => {
    await expect(create().prepare("h1", "when_idle")).resolves.toBe(true);
    expect(events).toEqual(["stop h1"]);
  });

  // Like a single-machine restart: running turns are interrupted (their ends
  // kept from waking the leader), every session stops, and the interrupted
  // ones get "Continue." once the host's node has restarted.
  it("interrupts turns, stops the sessions and continues the turns once the host is back", async () => {
    const updates = create();
    await expect(updates.prepare("h1", "immediate")).resolves.toBe(true);

    expect(events).toEqual(["interrupt busy true", "interrupt asking true", "stop h1"]);
    expect(held).toEqual([
      expect.objectContaining({ sessionIds: ["busy", "asking"], leaderIds: ["leader"], timeoutMs: 300 }),
    ]);

    updates.hostRestarted("h2");
    expect(events).toHaveLength(3);
    updates.hostRestarted("h1");
    expect(events.slice(3)).toEqual(["continue busy", "continue asking"]);
    // Continued once only.
    updates.hostRestarted("h1");
    expect(events).toHaveLength(5);
  });

  // A turn that does not end in time, or one that began during the
  // interrupts, ends with the restart too, so it is continued as well.
  it("continues turns that were still running when the sessions stopped", async () => {
    const updates = create({
      interrupt: async (sessionId) => {
        events.push(`interrupt ${sessionId}`);
        bridges.get("quiet")!.isGenerating = true;
      },
    });
    await updates.prepare("h1", "immediate");
    expect(events.at(-1)).toBe("stop h1");

    updates.hostRestarted("h1");
    expect(events.filter((event) => event.startsWith("continue")).sort()).toEqual([
      "continue asking",
      "continue busy",
      "continue quiet",
    ]);
  });

  // A landing run that started while turns were being interrupted must not be
  // cut off: the update is called off and the turns go on right away.
  it("calls the update off and continues the turns when a landing run began meanwhile", async () => {
    const updates = create({
      interrupt: async (sessionId) => {
        events.push(`interrupt ${sessionId}`);
        bridges.get(sessionId)!.isGenerating = false;
        landing = true;
      },
    });
    await expect(updates.prepare("h1", "immediate")).resolves.toBe(false);
    expect(events).toEqual(["interrupt busy", "interrupt asking", "continue busy", "continue asking"]);

    updates.hostRestarted("h1");
    expect(events).toHaveLength(4);
  });

  // With nothing in a turn there is nothing to interrupt or continue.
  it("only stops the sessions when none is in a turn", async () => {
    bridges.get("busy")!.isGenerating = false;
    bridges.get("asking")!.pendingPermissions = { size: 0 };
    const updates = create();
    await updates.prepare("h1", "immediate");
    updates.hostRestarted("h1");
    expect(events).toEqual(["stop h1"]);
    expect(held).toEqual([]);
  });
});
