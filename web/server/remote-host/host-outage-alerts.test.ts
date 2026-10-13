import type { HostLinkStatus } from "./host-link-manager.js";
import { HOST_OFFLINE_ALERT_MS, HostOutageAlerts } from "./host-outage-alerts.js";

/** Leaders hear when a remote host their sessions run on goes silent, and when it is back. */
describe("host outage alerts", () => {
  let clock: number;
  let statuses: Map<string, Partial<HostLinkStatus>>;
  let sessions: { sessionId: string; hostId?: string; archived?: boolean }[];
  let events: { sessionId: string; event: string; data: Record<string, unknown> }[];
  let alerts: HostOutageAlerts;

  beforeEach(() => {
    clock = 1_000_000;
    statuses = new Map([["condor", { online: true, lastSeenAt: clock, updating: false }]]);
    sessions = [
      { sessionId: "worker-a", hostId: "condor" },
      { sessionId: "worker-b", hostId: "condor" },
      { sessionId: "local-worker" },
      { sessionId: "archived-worker", hostId: "condor", archived: true },
    ];
    events = [];
    alerts = new HostOutageAlerts({
      status: (hostId) =>
        ({ hostId, online: false, lastSeenAt: null, updating: false, ...statuses.get(hostId) }) as HostLinkStatus,
      sessions: () => sessions,
      hostName: (hostId) => `${hostId}-name`,
      emit: (sessionId, event, data) => void events.push({ sessionId, event, data: { ...data } }),
      now: () => clock,
    });
  });

  // The incident shape: the host goes silent and stays away for hours. Brief
  // silence stays quiet; past the alert time each live session on the host
  // reports host_offline once, and each gets host_online when it returns.
  it("reports a host that stays silent, once, and its return", () => {
    const silentAt = clock;
    statuses.set("condor", { online: false, lastSeenAt: silentAt });
    clock += HOST_OFFLINE_ALERT_MS - 1;
    alerts.check();
    expect(events).toEqual([]);

    clock += 1;
    alerts.check();
    expect(events).toEqual([
      {
        sessionId: "worker-a",
        event: "host_offline",
        data: { hostId: "condor", hostName: "condor-name", offlineSince: silentAt },
      },
      {
        sessionId: "worker-b",
        event: "host_offline",
        data: { hostId: "condor", hostName: "condor-name", offlineSince: silentAt },
      },
    ]);

    clock += 60 * 60_000;
    alerts.check();
    expect(events).toHaveLength(2);

    // A session archived while the host was away is not told it is back.
    sessions[1] = { ...sessions[1], archived: true };
    statuses.set("condor", { online: true, lastSeenAt: clock });
    alerts.check();
    expect(events.slice(2)).toEqual([
      {
        sessionId: "worker-a",
        event: "host_online",
        data: { hostId: "condor", hostName: "condor-name", offlineForMs: clock - silentAt },
      },
    ]);
    alerts.check();
    expect(events).toHaveLength(3);
  });

  // A host the coordinator never heard from since it started (it was already
  // gone across a coordinator restart) counts as offline from the start.
  it("reports a host that never connected since the coordinator started", () => {
    statuses.set("condor", { online: false, lastSeenAt: null });
    clock += HOST_OFFLINE_ALERT_MS;
    alerts.check();
    expect(events.map((event) => [event.sessionId, event.event])).toEqual([
      ["worker-a", "host_offline"],
      ["worker-b", "host_offline"],
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

  // A session that starts waiting on an already reported host is told too, once.
  it("tells sessions added to a host that is already reported", () => {
    statuses.set("condor", { online: false, lastSeenAt: clock });
    clock += HOST_OFFLINE_ALERT_MS;
    alerts.check();
    sessions.push({ sessionId: "worker-c", hostId: "condor" });
    alerts.check();
    alerts.check();
    expect(events.map((event) => event.sessionId)).toEqual(["worker-a", "worker-b", "worker-c"]);
  });
});
