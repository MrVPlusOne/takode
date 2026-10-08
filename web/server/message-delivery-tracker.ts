/**
 * Tells senders whether a message queued for a session that was not running
 * actually reached it.
 *
 * A tracked message starts `pending` while the sender's CLI polls during a
 * short window that covers a normal relaunch, so the common case ends with a
 * definite answer and no follow-up. If it is still undelivered when the window
 * ends it becomes `queued`, and the sender (when it is a leader) gets one
 * follow-up when it is delivered or fails. Failing never removes the message
 * from the target's queue, so a later delivery is pushed as well: otherwise the
 * sender might resend a message that arrives after all.
 */

import { randomUUID } from "node:crypto";
import { isSessionPaused, type PauseableSession } from "./session-pause.js";

/** How long a sender waits for a definite answer; covers a normal local or remote relaunch. */
export const DELIVERY_WAIT_WINDOW_MS = 20_000;
/** A stopped target that nothing relaunches within this time will not receive the message. */
const STOPPED_GRACE_MS = 15_000;
/** Give up on any other wait (host offline, stuck start) after this long. */
const GIVE_UP_MS = 10 * 60_000;
/** Settled and abandoned records are forgotten after a day. */
const RECORD_TTL_MS = 24 * 60 * 60_000;
const POLL_MS = 2_000;
const PREVIEW_CHARS = 80;
const LOG_TAG = "[message-delivery]";

export type MessageDeliveryStatus = "pending" | "queued" | "delivered" | "failed";

export interface MessageDeliveryRecord {
  id: string;
  targetSessionId: string;
  senderSessionId: string;
  /** First characters of the message, so the sender can tell which one this is. */
  preview: string;
  /** Quest thread the message belongs to, if any. */
  questId?: string;
  queuedAt: number;
  /** `pending` until the wait window ends; `queued` afterwards while still undelivered. */
  status: MessageDeliveryStatus;
  /** Why the message is not delivered yet, or why delivery failed. */
  reason?: string;
  settledAt?: number;
  /** Whether the sender gets a herd event when a queued message is delivered or fails. */
  followUp: boolean;
}

/** What a target session's current state means for one sender's queued message. */
export type DeliveryProbe =
  | { kind: "delivered" }
  | { kind: "gone"; reason: string }
  | { kind: "waiting"; reason: string; wait: "starting" | "stopped" | "paused" | "host_offline" };

export interface MessageDeliveryTrackerDeps {
  probe: (targetSessionId: string, senderSessionId: string) => Promise<DeliveryProbe>;
  /** Push a follow-up to the sender of a queued message that was delivered or failed. */
  notifySender: (record: MessageDeliveryRecord) => void;
  now?: () => number;
}

interface WatchState {
  stoppedSince?: number;
}

export class MessageDeliveryTracker {
  private readonly records = new Map<string, MessageDeliveryRecord>();
  private readonly watch = new Map<string, WatchState>();
  private readonly launchFailures = new Map<string, { message: string; at: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: MessageDeliveryTrackerDeps) {}

  /** Start tracking a message that was queued rather than handed to a running backend. */
  track(input: {
    targetSessionId: string;
    senderSessionId: string;
    content: string;
    questId?: string;
    followUp: boolean;
  }): MessageDeliveryRecord {
    const preview = input.content.replace(/\s+/g, " ").trim();
    const record: MessageDeliveryRecord = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      targetSessionId: input.targetSessionId,
      senderSessionId: input.senderSessionId,
      preview: preview.length > PREVIEW_CHARS ? `${preview.slice(0, PREVIEW_CHARS - 3)}...` : preview,
      ...(input.questId ? { questId: input.questId } : {}),
      queuedAt: this.now(),
      status: "pending",
      reason: "the session is starting",
      followUp: input.followUp,
    };
    this.records.set(record.id, record);
    this.watch.set(record.id, {});
    this.ensureTimer();
    return { ...record };
  }

  /** Remember why a session failed to (re)launch, so waiting messages report it. */
  recordLaunchFailure(sessionId: string, message: string): void {
    this.launchFailures.set(sessionId, { message, at: this.now() });
  }

  /** Current status of a tracked message, re-checked against the target first. */
  async status(id: string): Promise<MessageDeliveryRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    if (this.watch.has(id)) await this.evaluate(record);
    return { ...record };
  }

  /** Tracked messages that have not reached a session yet, and its last launch failure, for `takode info`. */
  describeTarget(sessionId: string): {
    undeliveredMessages: MessageDeliveryRecord[];
    lastLaunchError: { message: string; at: number } | null;
  } {
    const undeliveredMessages = [...this.records.values()]
      .filter(
        (record) => record.targetSessionId === sessionId && record.status !== "delivered" && this.watch.has(record.id),
      )
      .map((record) => ({ ...record }));
    return { undeliveredMessages, lastLaunchError: this.launchFailures.get(sessionId) ?? null };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const [id, record] of this.records) {
        if (now - record.queuedAt < RECORD_TTL_MS) continue;
        this.records.delete(id);
        this.watch.delete(id);
      }
      for (const id of [...this.watch.keys()]) {
        const record = this.records.get(id);
        if (record) await this.evaluate(record);
      }
      if (this.watch.size === 0) this.dispose();
    } finally {
      this.ticking = false;
    }
  }

  private async evaluate(record: MessageDeliveryRecord): Promise<void> {
    let probe: DeliveryProbe;
    try {
      probe = await this.deps.probe(record.targetSessionId, record.senderSessionId);
    } catch (error) {
      console.warn(`${LOG_TAG} Could not check ${record.id}: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const watch = this.watch.get(record.id);
    if (!watch) return;
    const now = this.now();
    // The sender has been told "queued" once the window is over, so later outcomes are pushed.
    if (record.status === "pending" && now - record.queuedAt >= DELIVERY_WAIT_WINDOW_MS) record.status = "queued";

    if (probe.kind === "delivered") {
      this.watch.delete(record.id);
      this.settle(record, "delivered", undefined, now);
      return;
    }
    if (probe.kind === "gone") {
      this.watch.delete(record.id);
      if (record.status !== "failed") this.settle(record, "failed", probe.reason, now);
      return;
    }
    if (record.status === "failed") return;

    watch.stoppedSince = probe.wait === "stopped" ? (watch.stoppedSince ?? now) : undefined;
    const launchFailure = this.launchFailures.get(record.targetSessionId);
    if (probe.wait === "stopped" && launchFailure && launchFailure.at >= record.queuedAt) {
      this.settle(record, "failed", `relaunch failed: ${launchFailure.message}`, now);
    } else if (probe.wait === "stopped" && now - watch.stoppedSince! >= STOPPED_GRACE_MS) {
      this.settle(record, "failed", "the session stopped and is not being relaunched", now);
    } else if (probe.wait !== "paused" && now - record.queuedAt >= GIVE_UP_MS) {
      this.settle(record, "failed", `${probe.reason} after ${Math.round(GIVE_UP_MS / 60_000)} minutes`, now);
    } else {
      record.reason = probe.reason;
    }
  }

  private settle(
    record: MessageDeliveryRecord,
    status: "delivered" | "failed",
    reason: string | undefined,
    now: number,
  ): void {
    const told = record.status === "queued" || record.status === "failed";
    record.status = status;
    record.reason = reason;
    record.settledAt = now;
    const route = `${record.id} from ${record.senderSessionId} to ${record.targetSessionId}`;
    if (status === "failed") {
      // Stays watched: the message is still queued in the target and may arrive later.
      console.warn(`${LOG_TAG} Message ${route} not delivered: ${reason}`);
    } else {
      console.log(`${LOG_TAG} Message ${route} delivered after ${Math.round((now - record.queuedAt) / 1000)}s`);
    }
    if (told && record.followUp) this.deps.notifySender({ ...record });
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

/** The parts of a bridge session that decide whether its queued input has reached the backend. */
export interface DeliveryTargetSession extends PauseableSession {
  codexAdapter?: { isConnected(): boolean } | null;
  claudeSdkAdapter?: { isConnected(): boolean } | null;
  /** Input held by the server until a backend can take it (raw JSON browser messages). */
  pendingMessages: string[];
}

/**
 * Probe for production: a message counts as delivered once the target's
 * backend is running and the server no longer holds input from the sender for
 * it. A connected Claude SDK adapter has already flushed its own queue, and a
 * connected Codex adapter dispatches its pending inputs itself.
 */
export function createMessageDeliveryProbe(deps: {
  getLauncherSession: (
    sessionId: string,
  ) => { archived?: boolean; state: "starting" | "connected" | "running" | "exited"; hostId?: string } | undefined;
  getBridgeSession: (sessionId: string) => DeliveryTargetSession | undefined;
  hostIsOnline: (hostId: string) => boolean;
  hostName: (hostId: string) => Promise<string>;
}): MessageDeliveryTrackerDeps["probe"] {
  return async (targetSessionId, senderSessionId) => {
    const info = deps.getLauncherSession(targetSessionId);
    const session = deps.getBridgeSession(targetSessionId);
    if (!info || !session) return { kind: "gone", reason: "the session no longer exists" };
    if (info.archived) return { kind: "gone", reason: "the session was archived" };
    const backendState = session.state.backend_state;
    if (backendState === "broken" || backendState === "recovery_suppressed") {
      return { kind: "waiting", reason: "the session's recovery is paused until a manual Resume", wait: "starting" };
    }
    const connected = !!(session.claudeSdkAdapter?.isConnected() || session.codexAdapter?.isConnected());
    if (connected && !holdsInputFrom(session, senderSessionId)) return { kind: "delivered" };
    if (isSessionPaused(session)) return { kind: "waiting", reason: "the session is paused", wait: "paused" };
    if (info.hostId && !deps.hostIsOnline(info.hostId)) {
      return { kind: "waiting", reason: `host ${await deps.hostName(info.hostId)} is offline`, wait: "host_offline" };
    }
    if (info.state === "exited") return { kind: "waiting", reason: "the session is stopped", wait: "stopped" };
    return { kind: "waiting", reason: "the session is starting", wait: "starting" };
  };
}

function holdsInputFrom(session: DeliveryTargetSession, senderSessionId: string): boolean {
  return session.pendingMessages.some((raw) => {
    try {
      const msg = JSON.parse(raw) as { type?: string; agentSource?: { sessionId?: string } };
      return msg.type === "user_message" && msg.agentSource?.sessionId === senderSessionId;
    } catch {
      return false;
    }
  });
}
