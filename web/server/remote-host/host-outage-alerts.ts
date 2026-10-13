import type { TakodeEventDataByType } from "../takode-event-types.js";
import type { HostLinkStatus } from "./host-link-manager.js";

/**
 * How long a remote host may stay silent before the leaders of its sessions
 * hear about it, so brief drops (a network blip, a quick reconnect) stay quiet.
 * The link itself notices silence within `HOST_LINK_STALE_MS`.
 */
export const HOST_OFFLINE_ALERT_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 15_000;

export interface HostOutageAlertDeps {
  status: (hostId: string) => HostLinkStatus;
  /** Sessions with the registered remote host each runs on, if any. */
  sessions: () => Iterable<{ sessionId: string; hostId?: string; archived?: boolean }>;
  hostName: (hostId: string) => string;
  /** Emit a herd event for a session; it reaches the session's leader. */
  emit: <E extends "host_offline" | "host_online">(sessionId: string, event: E, data: TakodeEventDataByType[E]) => void;
  now?: () => number;
}

/**
 * Tells leaders when a remote host their sessions run on stops answering, and
 * when it is back. Without it an outage is silent: work sent to those sessions
 * waits for the host while they look like any other session. A host restarting
 * for a Takode update is expected to be away and is reported only once the
 * update counts as failed. A host already silent when this coordinator starts
 * counts as offline from the start.
 */
export class HostOutageAlerts {
  /** Hosts reported offline: when they went silent and which sessions were told. */
  private readonly reported = new Map<string, { since: number; sessionIds: Set<string> }>();
  private readonly startedAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: HostOutageAlertDeps) {
    this.startedAt = this.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Report hosts that went silent long enough ago, and hosts that are back. */
  check(): void {
    const now = this.now();
    const sessionsByHost = new Map<string, string[]>();
    for (const session of this.deps.sessions()) {
      if (!session.hostId || session.archived) continue;
      const ids = sessionsByHost.get(session.hostId) ?? [];
      ids.push(session.sessionId);
      sessionsByHost.set(session.hostId, ids);
    }

    for (const [hostId, report] of this.reported) {
      if (!this.deps.status(hostId).online) continue;
      this.reported.delete(hostId);
      const live = new Set(sessionsByHost.get(hostId));
      const data = { hostId, hostName: this.deps.hostName(hostId), offlineForMs: now - report.since };
      for (const sessionId of report.sessionIds)
        if (live.has(sessionId)) this.deps.emit(sessionId, "host_online", data);
    }

    for (const [hostId, sessionIds] of sessionsByHost) {
      const status = this.deps.status(hostId);
      if (status.online || status.updating) continue;
      const since = status.lastSeenAt ?? this.startedAt;
      if (now - since < HOST_OFFLINE_ALERT_MS) continue;
      let report = this.reported.get(hostId);
      if (!report) {
        report = { since, sessionIds: new Set() };
        this.reported.set(hostId, report);
      }
      const data = { hostId, hostName: this.deps.hostName(hostId), offlineSince: report.since };
      for (const sessionId of sessionIds) {
        if (report.sessionIds.has(sessionId)) continue;
        report.sessionIds.add(sessionId);
        this.deps.emit(sessionId, "host_offline", data);
      }
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
