import { afterEach, describe, expect, it, vi } from "vitest";
import { HerdEventDispatcher, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import type { TakodeEvent } from "./session-types.js";

describe("human-triggered herd delivery", () => {
  afterEach(() => vi.useRealTimers());
  it("flushes only earlier events and preserves alternating thread chronology", () => {
    vi.useFakeTimers();
    let receive!: (event: TakodeEvent) => void;
    const send = vi.fn(() => "queued" as const);
    const bridge = {
      subscribeTakodeEvents: (_ids: Set<string>, callback: typeof receive) => {
        receive = callback;
        return () => {};
      },
      injectUserMessage: send,
      isSessionIdle: () => false,
      getSession: () => ({ backendType: "codex", messageHistory: [] }),
    } as unknown as WsBridgeHandle;
    const dispatcher = new HerdEventDispatcher(bridge, { getHerdedSessions: () => [{ sessionId: "worker" }] });
    dispatcher.setupForOrchestrator("leader");
    for (const [index, threadKey] of ["q-1", "q-2", "q-1", "q-3"].entries()) {
      receive({
        id: index + 1,
        event: "turn_end",
        sessionId: "worker",
        sessionNum: 1,
        sessionName: "worker",
        ts: index + 1,
        data: { threadKey, questId: threadKey, reason: "result", msgRange: { from: index * 2, to: index * 2 + 1 } },
      } as TakodeEvent);
    }
    // Background-only traffic has no right to break into the active turn.
    expect(send).not.toHaveBeenCalled();
    dispatcher.forceFlushPendingEvents("leader", 3);
    expect(send.mock.calls.map((call) => (call as unknown as any[])[4].threadKey)).toEqual(["q-1", "q-2", "q-1"]);
    expect(
      send.mock.calls.flatMap((call) => (call as unknown as any[])[3].events.map((event: TakodeEvent) => event.id)),
    ).toEqual([1, 2, 3]);
  });
});
