import {
  createMessageDeliveryProbe,
  DELIVERY_WAIT_WINDOW_MS,
  MessageDeliveryTracker,
} from "./message-delivery-tracker.js";
import type { DeliveryProbe, DeliveryTargetSession, MessageDeliveryRecord } from "./message-delivery-tracker.js";

/**
 * The tracker decides what a sender is told about a message queued for a
 * session that was not running: a definite answer inside the wait window, or
 * "queued" plus exactly one pushed follow-up when it is later delivered or
 * fails (and one more if a failed message is delivered after all).
 */
function setup(initial: DeliveryProbe) {
  let now = 1_000_000;
  let probe = initial;
  const notified: MessageDeliveryRecord[] = [];
  const tracker = new MessageDeliveryTracker({
    probe: async () => probe,
    notifySender: (record) => notified.push(record),
    now: () => now,
  });
  const record = tracker.track({
    targetSessionId: "target",
    senderSessionId: "leader",
    content: "Please   take over\nthe handover",
    followUp: true,
  });
  return {
    tracker,
    record,
    notified,
    setProbe: (next: DeliveryProbe) => (probe = next),
    advance: (ms: number) => (now += ms),
  };
}

const starting: DeliveryProbe = { kind: "waiting", reason: "the session is starting", wait: "starting" };
const stopped: DeliveryProbe = { kind: "waiting", reason: "the session is stopped", wait: "stopped" };

describe("MessageDeliveryTracker", () => {
  it("answers delivered inside the wait window without a follow-up", async () => {
    // The common relaunch case: the sender's CLI reads the definite result itself.
    const t = setup(starting);
    expect(t.record.preview).toBe("Please take over the handover");
    t.advance(5_000);
    expect((await t.tracker.status(t.record.id))?.status).toBe("pending");
    t.setProbe({ kind: "delivered" });
    expect((await t.tracker.status(t.record.id))?.status).toBe("delivered");
    expect(t.notified).toEqual([]);
    t.tracker.dispose();
  });

  it("becomes queued after the window and pushes one follow-up when delivered", async () => {
    const t = setup(starting);
    t.advance(DELIVERY_WAIT_WINDOW_MS);
    const queued = await t.tracker.status(t.record.id);
    expect(queued).toMatchObject({ status: "queued", reason: "the session is starting" });
    t.setProbe({ kind: "delivered" });
    await t.tracker.status(t.record.id);
    await t.tracker.status(t.record.id);
    expect(t.notified.map((r) => r.status)).toEqual(["delivered"]);
    t.tracker.dispose();
  });

  it("fails at once with the recorded relaunch error, then reports a late delivery", async () => {
    // A relaunch failure gives the sender the real reason; because the message
    // stays queued, a later successful start is pushed too so it is not resent.
    const t = setup(stopped);
    t.tracker.recordLaunchFailure("target", "Working directory not found: /remote/path");
    t.advance(1_000);
    expect(await t.tracker.status(t.record.id)).toMatchObject({
      status: "failed",
      reason: "relaunch failed: Working directory not found: /remote/path",
    });
    expect(t.notified).toEqual([]); // definite at send time: the CLI printed it
    expect(t.tracker.describeTarget("target").undeliveredMessages.map((r) => r.id)).toEqual([t.record.id]);
    t.setProbe({ kind: "delivered" });
    t.advance(60_000);
    await t.tracker.status(t.record.id);
    expect(t.notified.map((r) => r.status)).toEqual(["delivered"]);
    expect(t.tracker.describeTarget("target").undeliveredMessages).toEqual([]);
    t.tracker.dispose();
  });

  it("ignores launch failures recorded before the message was queued", async () => {
    const t = setup(stopped);
    t.advance(-1);
    t.tracker.recordLaunchFailure("target", "old failure");
    t.advance(2);
    expect((await t.tracker.status(t.record.id))?.status).toBe("pending");
    t.tracker.dispose();
  });

  it("fails a stopped session that nothing relaunches, pushing it once the sender was told queued", async () => {
    const t = setup(starting);
    t.advance(DELIVERY_WAIT_WINDOW_MS);
    await t.tracker.status(t.record.id);
    t.setProbe(stopped);
    await t.tracker.status(t.record.id);
    t.advance(15_000);
    expect(await t.tracker.status(t.record.id)).toMatchObject({
      status: "failed",
      reason: "the session stopped and is not being relaunched",
    });
    expect(t.notified.map((r) => [r.status, r.reason])).toEqual([
      ["failed", "the session stopped and is not being relaunched"],
    ]);
    t.tracker.dispose();
  });

  it("waits for an offline host up to the give-up limit", async () => {
    const t = setup({ kind: "waiting", reason: "host devbox is offline", wait: "host_offline" });
    t.advance(5 * 60_000);
    expect(await t.tracker.status(t.record.id)).toMatchObject({ status: "queued", reason: "host devbox is offline" });
    t.advance(5 * 60_000);
    expect(await t.tracker.status(t.record.id)).toMatchObject({
      status: "failed",
      reason: "host devbox is offline after 10 minutes",
    });
    expect(t.notified).toHaveLength(1);
    t.tracker.dispose();
  });

  it("never gives up on a paused session", async () => {
    const t = setup({ kind: "waiting", reason: "the session is paused", wait: "paused" });
    t.advance(60 * 60_000);
    expect((await t.tracker.status(t.record.id))?.status).toBe("queued");
    t.tracker.dispose();
  });

  it("fails without further watching when the target is archived", async () => {
    const t = setup(starting);
    t.advance(DELIVERY_WAIT_WINDOW_MS);
    await t.tracker.status(t.record.id);
    t.setProbe({ kind: "gone", reason: "the session was archived" });
    await t.tracker.status(t.record.id);
    t.setProbe({ kind: "delivered" });
    await t.tracker.status(t.record.id);
    expect(t.notified.map((r) => r.status)).toEqual(["failed"]);
    t.tracker.dispose();
  });
});

describe("createMessageDeliveryProbe", () => {
  function bridgeSession(overrides: Partial<DeliveryTargetSession> = {}): DeliveryTargetSession {
    return {
      id: "target",
      state: {} as DeliveryTargetSession["state"],
      claudeSdkAdapter: { isConnected: () => true },
      pendingMessages: [],
      ...overrides,
    };
  }

  function probeFor(
    session: DeliveryTargetSession | undefined,
    info: { archived?: boolean; state: "starting" | "connected" | "running" | "exited"; hostId?: string } | undefined,
    online = true,
  ) {
    return createMessageDeliveryProbe({
      getLauncherSession: () => info,
      getBridgeSession: () => session,
      hostIsOnline: () => online,
      hostName: async () => "devbox",
    })("target", "leader");
  }

  const queuedFromLeader = JSON.stringify({
    type: "user_message",
    content: "hi",
    agentSource: { sessionId: "leader" },
  });

  it("counts a message delivered once the backend runs and holds nothing from the sender", async () => {
    expect(await probeFor(bridgeSession(), { state: "connected" })).toEqual({ kind: "delivered" });
    // Input from other senders does not hold this sender's message back.
    const other = JSON.stringify({ type: "user_message", content: "x", agentSource: { sessionId: "other" } });
    expect(await probeFor(bridgeSession({ pendingMessages: [other] }), { state: "connected" })).toEqual({
      kind: "delivered",
    });
  });

  it("keeps waiting while the server still holds the sender's input (e.g. during resume replay)", async () => {
    const session = bridgeSession({ pendingMessages: [queuedFromLeader] });
    expect(await probeFor(session, { state: "connected" })).toMatchObject({ kind: "waiting", wait: "starting" });
  });

  it("names an offline host and a stopped session", async () => {
    const disconnected = bridgeSession({ claudeSdkAdapter: null, pendingMessages: [queuedFromLeader] });
    expect(await probeFor(disconnected, { state: "starting", hostId: "h1" }, false)).toEqual({
      kind: "waiting",
      reason: "host devbox is offline",
      wait: "host_offline",
    });
    expect(await probeFor(disconnected, { state: "exited" })).toMatchObject({ kind: "waiting", wait: "stopped" });
  });

  it("reports archived and missing sessions as gone", async () => {
    expect(await probeFor(bridgeSession(), { state: "exited", archived: true })).toEqual({
      kind: "gone",
      reason: "the session was archived",
    });
    expect(await probeFor(undefined, undefined)).toMatchObject({ kind: "gone" });
  });
});
