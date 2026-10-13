import type { HostLinkStatus } from "./host-link-manager.js";
import {
  HOST_OFFLINE_ALERT_MS,
  type HeldWork,
  HostOutageAlerts,
  type HostOutageSessionView,
  describeHeldWork,
} from "./host-outage-alerts.js";

/**
 * Leaders hear when a remote host goes silent while their sessions there have
 * work under way: one alert per host per leader, listing those sessions and
 * why, and "back online" only after such an alert.
 */
describe("host outage alerts", () => {
  let clock: number;
  let statuses: Map<string, Partial<HostLinkStatus>>;
  let sessions: HostOutageSessionView[];
  let held: Map<string, HeldWork>;
  let events: { leaderId: string; event: string; data: Record<string, unknown> }[];
  let alerts: HostOutageAlerts;

  beforeEach(() => {
    clock = 1_000_000;
    statuses = new Map([["condor", { online: true, lastSeenAt: clock, updating: false }]]);
    sessions = [
      { sessionId: "busy-a", sessionNum: 11, hostId: "condor", herdedBy: "leader-1" },
      { sessionId: "idle-b", sessionNum: 12, hostId: "condor", herdedBy: "leader-1" },
      { sessionId: "quest-c", sessionNum: 13, hostId: "condor", herdedBy: "leader-2" },
      { sessionId: "unherded-d", sessionNum: 14, hostId: "condor" },
      { sessionId: "local-e", sessionNum: 15, herdedBy: "leader-1" },
    ];
    held = new Map([
      ["busy-a", { reasons: ["mid-turn", "1 message waiting"] }],
      ["quest-c", { reasons: ["q-7 in Work"], questId: "q-7" }],
      ["unherded-d", { reasons: ["mid-turn"] }],
      ["local-e", { reasons: ["mid-turn"] }],
    ]);
    events = [];
    alerts = new HostOutageAlerts({
      status: (hostId) =>
        ({ hostId, online: false, lastSeenAt: null, updating: false, ...statuses.get(hostId) }) as HostLinkStatus,
      sessions: () => sessions,
      heldWork: (session) => held.get(session.sessionId) ?? { reasons: [] },
      hostName: (hostId) => `${hostId}-name`,
      emit: (leaderId, event, data) => void events.push({ leaderId, event, data: { ...data } }),
      now: () => clock,
    });
  });

  /** The host goes silent: what each session had under way is noted then, as alert checks run on status changes. */
  function goSilent(): number {
    const silentAt = clock;
    statuses.set("condor", { online: false, lastSeenAt: silentAt });
    alerts.check();
    return silentAt;
  }

  // The incident shape: the host goes silent and stays away for hours. Brief
  // silence stays quiet; past the alert time each leader with held work there
  // gets one alert listing its affected sessions and why. Idle and unherded
  // sessions are left out, and so is a leader whose sessions there are all idle.
  it("alerts each leader once about its affected sessions, and reports the return", () => {
    const silentAt = goSilent();
    clock += HOST_OFFLINE_ALERT_MS - 1;
    alerts.check();
    expect(events).toEqual([]);

    clock += 1;
    alerts.check();
    expect(events).toEqual([
      {
        leaderId: "leader-1",
        event: "host_offline",
        data: {
          hostId: "condor",
          hostName: "condor-name",
          offlineSince: silentAt,
          sessions: [{ sessionId: "busy-a", sessionNum: 11, reasons: ["mid-turn", "1 message waiting"] }],
        },
      },
      {
        leaderId: "leader-2",
        event: "host_offline",
        data: {
          hostId: "condor",
          hostName: "condor-name",
          offlineSince: silentAt,
          sessions: [{ sessionId: "quest-c", sessionNum: 13, reasons: ["q-7 in Work"], questId: "q-7" }],
          // Every listed session works on q-7, so the alert goes to that quest's thread.
          questId: "q-7",
        },
      },
    ]);

    clock += 60 * 60_000;
    alerts.check();
    expect(events).toHaveLength(2);

    statuses.set("condor", { online: true, lastSeenAt: clock });
    alerts.check();
    expect(events.slice(2)).toEqual([
      {
        leaderId: "leader-1",
        event: "host_online",
        data: {
          hostId: "condor",
          hostName: "condor-name",
          offlineForMs: clock - silentAt,
          sessions: [{ sessionId: "busy-a", sessionNum: 11, reasons: ["mid-turn", "1 message waiting"] }],
        },
      },
      {
        leaderId: "leader-2",
        event: "host_online",
        data: {
          hostId: "condor",
          hostName: "condor-name",
          offlineForMs: clock - silentAt,
          sessions: [{ sessionId: "quest-c", sessionNum: 13, reasons: ["q-7 in Work"], questId: "q-7" }],
          questId: "q-7",
        },
      },
    ]);
    alerts.check();
    expect(events).toHaveLength(4);
  });

  // The laptop-sleep case: every session on the host is idle with nothing
  // pending, so neither the outage nor the return produces an alert.
  it("stays quiet about a host whose sessions are all idle", () => {
    held.clear();
    goSilent();
    clock += 60 * 60_000;
    alerts.check();
    statuses.set("condor", { online: true, lastSeenAt: clock });
    alerts.check();
    expect(events).toEqual([]);
  });

  // Held work is noted when the host goes away. Messages sent to an idle
  // session afterwards are covered by their own delivery notices, so they do
  // not turn it into an alert.
  it("judges sessions by what they had under way when the host went away", () => {
    goSilent();
    held.set("idle-b", { reasons: ["1 message waiting"] });
    clock += HOST_OFFLINE_ALERT_MS;
    alerts.check();
    const leader1 = events.find((event) => event.leaderId === "leader-1");
    expect((leader1?.data.sessions as { sessionId: string }[]).map((session) => session.sessionId)).toEqual(["busy-a"]);
  });

  // A brief outage that ends before the alert time is never reported, so no
  // "back online" follows either.
  it("sends no return notice for an outage that was never reported", () => {
    goSilent();
    clock += HOST_OFFLINE_ALERT_MS - 1;
    statuses.set("condor", { online: true, lastSeenAt: clock });
    alerts.check();
    clock += HOST_OFFLINE_ALERT_MS;
    alerts.check();
    expect(events).toEqual([]);
  });

  // Sessions archived while the host is away drop out of both notices.
  it("leaves out sessions archived during the outage", () => {
    goSilent();
    clock += HOST_OFFLINE_ALERT_MS;
    alerts.check();
    sessions = sessions.map((session) => (session.sessionId === "quest-c" ? { ...session, archived: true } : session));
    statuses.set("condor", { online: true, lastSeenAt: clock });
    alerts.check();
    expect(events.filter((event) => event.event === "host_online").map((event) => event.leaderId)).toEqual([
      "leader-1",
    ]);
  });

  // A host the coordinator never heard from since it started (it was already
  // gone across a coordinator restart) counts as offline from the start.
  it("reports a host that never connected since the coordinator started", () => {
    statuses.set("condor", { online: false, lastSeenAt: null });
    clock += HOST_OFFLINE_ALERT_MS;
    alerts.check();
    expect(events.map((event) => [event.leaderId, event.event])).toEqual([
      ["leader-1", "host_offline"],
      ["leader-2", "host_offline"],
    ]);
  });

  // A host restarting for a Takode update is expected to be away; it is
  // reported only if it is still away once the update stops counting as in flight.
  it("stays quiet while the host restarts for an update", () => {
    const silentAt = clock;
    statuses.set("condor", { online: false, lastSeenAt: silentAt, updating: true });
    clock += 10 * 60_000;
    alerts.check();
    expect(events).toEqual([]);

    statuses.set("condor", { online: false, lastSeenAt: silentAt, updating: false });
    alerts.check();
    expect(events.map((event) => event.event)).toEqual(["host_offline", "host_offline"]);
  });
});

/** What counts as work an outage holds up, read from the bridge session and the leader's board. */
describe("describeHeldWork", () => {
  const idle = { isGenerating: false, pendingMessages: [], pendingCodexInputs: [] };

  it("is empty for an idle session with nothing pending and no active quest", () => {
    // A queued row has not been dispatched and a landing row no longer needs its worker.
    const board = [
      { questId: "q-1", worker: "s1", status: "QUEUED" },
      { questId: "q-2", worker: "s1", status: "LANDING" },
      { questId: "q-3", worker: "other", status: "WORKING" },
    ];
    expect(describeHeldWork("s1", idle, board)).toEqual({ reasons: [] });
  });

  it("lists a running turn, waiting input and the active board quest", () => {
    const session = {
      isGenerating: true,
      // Only queued user messages count as messages; other held commands do not.
      pendingMessages: [JSON.stringify({ type: "user_message", content: "hi" }), JSON.stringify({ type: "interrupt" })],
      pendingCodexInputs: [{}],
    };
    expect(describeHeldWork("s1", session, [{ questId: "q-9", worker: "s1", status: "WORKING" }])).toEqual({
      reasons: ["mid-turn", "2 messages waiting", "q-9 in Work"],
      questId: "q-9",
    });
  });
});
