import { getQuestJourneyPresentation } from "../../shared/quest-journey.js";
import type { TakodeEventDataByType, TakodeHostOutageSession } from "../takode-event-types.js";
import type { HostLinkStatus } from "./host-link-manager.js";

/**
 * How long a remote host may stay silent before leaders hear about it, so
 * brief drops (a network blip, a quick reconnect) stay quiet. The link itself
 * notices silence within `HOST_LINK_STALE_MS`.
 */
export const HOST_OFFLINE_ALERT_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 15_000;

/** Board states whose worker is not doing the quest's work right now. */
const NOT_WORKING_BOARD_STATES = new Set(["PROPOSED", "QUEUED", "LANDING"]);

export interface HostOutageSessionView {
  sessionId: string;
  sessionNum?: number;
  /** The registered remote host the session runs on, if any. */
  hostId?: string;
  archived?: boolean;
  /** The leader herding the session; only leaders hear about outages. */
  herdedBy?: string;
}

export interface HostOutageAlertDeps {
  status: (hostId: string) => HostLinkStatus;
  sessions: () => Iterable<HostOutageSessionView>;
  /** What the session has under way that an outage holds up (see `describeHeldWork`). */
  heldWork: (session: HostOutageSessionView) => HeldWork;
  hostName: (hostId: string) => string;
  /** Emit a herd event straight to a leader. */
  emit: <E extends "host_offline" | "host_online">(leaderId: string, event: E, data: TakodeEventDataByType[E]) => void;
  now?: () => number;
}

export interface HeldWork {
  /** Why an outage holds up the session's work; empty for an idle session with nothing pending. */
  reasons: string[];
  /** The board quest the session works on. */
  questId?: string;
}

interface Outage {
  since: number;
  /** Per leader, its sessions whose work the outage holds up, as they stood when the host went away. */
  affected: Map<string, TakodeHostOutageSession[]>;
  alerted: boolean;
}

/**
 * Tells leaders when a remote host stops answering while their sessions there
 * have work under way, and when it is back. Each leader gets one alert per
 * outage listing its affected sessions and why. Sessions that were idle with
 * nothing pending stay quiet: anyone who contacts one later learns from the
 * message's own delivery notices. "Back online" goes only to leaders that got
 * the offline alert. A host restarting for a Takode update is expected to be
 * away and is reported only once the update counts as failed. A host already
 * silent when this coordinator starts counts as offline from the start.
 *
 * Call `check` when a host's link status changes, so the held work is captured
 * when the host goes away; the timer started by `start` covers the alert delay.
 */
export class HostOutageAlerts {
  private readonly outages = new Map<string, Outage>();
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

  /** Note hosts that went away, alert for those silent long enough, and report alerted hosts that are back. */
  check(): void {
    const now = this.now();
    const sessionsByHost = new Map<string, HostOutageSessionView[]>();
    for (const session of this.deps.sessions()) {
      if (!session.hostId || session.archived) continue;
      const list = sessionsByHost.get(session.hostId) ?? [];
      list.push(session);
      sessionsByHost.set(session.hostId, list);
    }
    const liveIds = new Set([...sessionsByHost.values()].flat().map((session) => session.sessionId));

    for (const [hostId, outage] of this.outages) {
      if (!this.deps.status(hostId).online) continue;
      this.outages.delete(hostId);
      if (!outage.alerted) continue;
      const base = { hostId, hostName: this.deps.hostName(hostId), offlineForMs: now - outage.since };
      for (const [leaderId, sessions] of outage.affected) {
        const live = sessions.filter((session) => liveIds.has(session.sessionId));
        if (live.length > 0) this.deps.emit(leaderId, "host_online", { ...base, ...withSessions(live) });
      }
    }

    for (const [hostId, sessions] of sessionsByHost) {
      const status = this.deps.status(hostId);
      if (status.online || status.updating) continue;
      let outage = this.outages.get(hostId);
      if (!outage) {
        outage = {
          since: status.lastSeenAt ?? this.startedAt,
          affected: this.affectedByLeader(sessions),
          alerted: false,
        };
        this.outages.set(hostId, outage);
      }
      if (outage.alerted || now - outage.since < HOST_OFFLINE_ALERT_MS) continue;
      outage.alerted = true;
      const base = { hostId, hostName: this.deps.hostName(hostId), offlineSince: outage.since };
      for (const [leaderId, affected] of outage.affected) {
        const live = affected.filter((session) => liveIds.has(session.sessionId));
        if (live.length > 0) this.deps.emit(leaderId, "host_offline", { ...base, ...withSessions(live) });
      }
    }
  }

  private affectedByLeader(sessions: HostOutageSessionView[]): Map<string, TakodeHostOutageSession[]> {
    const affected = new Map<string, TakodeHostOutageSession[]>();
    for (const session of sessions) {
      if (!session.herdedBy) continue;
      const held = this.deps.heldWork(session);
      if (held.reasons.length === 0) continue;
      const list = affected.get(session.herdedBy) ?? [];
      list.push({
        sessionId: session.sessionId,
        ...(session.sessionNum !== undefined ? { sessionNum: session.sessionNum } : {}),
        reasons: held.reasons,
        ...(held.questId ? { questId: held.questId } : {}),
      });
      affected.set(session.herdedBy, list);
    }
    return affected;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

/**
 * What a session has under way that a host outage holds up: a running turn,
 * input waiting for its backend, and an active quest it works on for its
 * leader's board.
 */
export function describeHeldWork(
  sessionId: string,
  session: { isGenerating: boolean; pendingMessages: string[]; pendingCodexInputs: unknown[] } | undefined,
  leaderBoard: Iterable<{ questId: string; worker?: string; status?: string }>,
): HeldWork {
  const reasons: string[] = [];
  if (session?.isGenerating) reasons.push("mid-turn");
  const waiting = session
    ? session.pendingMessages.filter(isUserMessage).length + session.pendingCodexInputs.length
    : 0;
  if (waiting > 0) reasons.push(`${waiting} message${waiting === 1 ? "" : "s"} waiting`);
  for (const row of leaderBoard) {
    const state = (row.status ?? "").trim().toUpperCase();
    if (row.worker !== sessionId || NOT_WORKING_BOARD_STATES.has(state)) continue;
    const phase = getQuestJourneyPresentation(row.status)?.label ?? row.status;
    reasons.push(phase ? `${row.questId} in ${phase}` : row.questId);
    return { reasons, questId: row.questId };
  }
  return { reasons };
}

/** The listed sessions, plus their quest when they all work on the same one, so the event reaches its thread. */
function withSessions(sessions: TakodeHostOutageSession[]): { sessions: TakodeHostOutageSession[]; questId?: string } {
  const questIds = new Set(sessions.map((session) => session.questId));
  const [questId] = questIds;
  return questIds.size === 1 && questId ? { sessions, questId } : { sessions };
}

function isUserMessage(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { type?: string }).type === "user_message";
  } catch {
    return false;
  }
}
