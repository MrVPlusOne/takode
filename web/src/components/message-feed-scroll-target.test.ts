import { describe, expect, it } from "vitest";
import { getMissingScrollTargetWindowAction, type PendingTargetWindowRequest } from "./message-feed-scroll-target.js";

// A jump whose target the feed lacks looks it up in a window built around the target. Only that
// reply, which names the target, may end the lookup; other deliveries arriving meanwhile must not.
// A lookup whose reply may be lost is sent once more, and the jump then gives up.

const KEY = "q-1:msg-target";
const TARGET = "msg-target";
const held = { target_message_id: undefined };

function pending(overrides: Partial<PendingTargetWindowRequest> = {}): PendingTargetWindowRequest {
  return { key: KEY, window: held, retryTick: 0, connectionEpoch: 0, retried: false, folded: false, ...overrides };
}

function act(
  current: PendingTargetWindowRequest | null,
  window: { target_message_id?: string } | null,
  { retryTick = 0, connectionEpoch = 0 } = {},
) {
  return getMissingScrollTargetWindowAction({
    pending: current,
    requestKey: KEY,
    targetMessageId: TARGET,
    window,
    retryTick,
    connectionEpoch,
  });
}

describe("getMissingScrollTargetWindowAction", () => {
  it("looks the target up once and waits while the held window is unchanged", () => {
    expect(act(null, held)).toEqual({ kind: "request", pending: pending() });
    expect(act(pending(), held)).toEqual({ kind: "wait" });
  });

  it("keeps waiting through a delivery built for something else", () => {
    // Opening the leader log asks for its latest window just before the jump's lookup; that
    // reply arrives first. Giving up on it abandoned the jump on slow links.
    expect(act(pending(), { target_message_id: undefined })).toEqual({ kind: "wait" });
  });

  it("gives up once the lookup's reply arrived without the target", () => {
    expect(act(pending(), { target_message_id: TARGET })).toEqual({ kind: "fallback" });
  });

  it("sends a lookup that waited for the conversation's first window once that window arrives", () => {
    // With no window held, the lookup cannot go out on its own: it joins the first window's
    // request (a thread) or waits for the first window (a history view), neither of which names
    // the target.
    const first = { target_message_id: undefined };
    expect(act(pending({ window: null, folded: true }), first)).toEqual({
      kind: "request",
      pending: pending({ window: first }),
    });
    // That first window may be built for the target already.
    expect(act(pending({ window: null, folded: true }), { target_message_id: TARGET })).toEqual({ kind: "fallback" });
  });

  it("asks again when the connection came back with a window not built for the target", () => {
    // The phone backgrounded after the lookup was sent: its reply was lost with the old
    // connection, and the window the reconnect brings is the latest one.
    const afterReconnect = { target_message_id: undefined };
    expect(act(pending(), held, { connectionEpoch: 1 })).toEqual({ kind: "wait" });
    expect(act(pending(), afterReconnect, { connectionEpoch: 1 })).toEqual({
      kind: "request",
      pending: pending({ window: afterReconnect, connectionEpoch: 1, retried: true }),
    });
  });

  it("asks once more when no reply came in time, then gives up", () => {
    const retried = act(pending(), held, { retryTick: 1 });
    expect(retried).toEqual({ kind: "request", pending: pending({ retryTick: 1, retried: true }) });
    if (retried.kind !== "request") return;
    expect(act(retried.pending, held, { retryTick: 1 })).toEqual({ kind: "wait" });
    expect(act(retried.pending, held, { retryTick: 2 })).toEqual({ kind: "fallback" });
  });
});
