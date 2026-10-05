import { afterEach, expect, it, vi } from "vitest";
import { HerdEventDispatcher, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import { serverWorkAdmission } from "./server-work-admission.js";
import type { TakodeEvent } from "./session-types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("transfers buffered events into pending input once while backend dispatch is stopped", () => {
  // These observations were accepted before shutdown. Preserve their source/routing instead of dropping them.
  vi.useFakeTimers();
  let receive!: (event: TakodeEvent) => void;
  const bridge = {
    subscribeTakodeEvents: (_sessions: unknown, callback: typeof receive) => {
      receive = callback;
      return () => {};
    },
    injectUserMessage: vi.fn(() => {
      expect(serverWorkAdmission.isStopping()).toBe(true);
      expect(serverWorkAdmission.isPreservingQueuedWork()).toBe(true);
      return "queued" as const;
    }),
    getSession: () => ({ messageHistory: [], backendType: "claude", state: {} }),
    isSessionIdle: () => false,
    wakeIdleKilledSession: () => false,
  } satisfies WsBridgeHandle;
  const dispatcher = new HerdEventDispatcher(bridge, { getHerdedSessions: () => [{ sessionId: "worker" }] });
  dispatcher.setupForOrchestrator("leader");
  receive({
    id: 1,
    event: "turn_end",
    sessionId: "worker",
    ts: Date.now(),
    data: { reason: "result", duration_ms: 100 },
  } as TakodeEvent);
  expect(bridge.injectUserMessage).not.toHaveBeenCalled();
  vi.spyOn(serverWorkAdmission, "isStopping").mockReturnValue(true);
  dispatcher.preservePendingForShutdown();
  dispatcher.preservePendingForShutdown();
  expect(bridge.injectUserMessage).toHaveBeenCalledOnce();
  expect(serverWorkAdmission.isPreservingQueuedWork()).toBe(false);
  dispatcher.destroy();
});

it("blocks the save barrier if a buffered event cannot be transferred", () => {
  vi.useFakeTimers();
  let receive!: (event: TakodeEvent) => void;
  const bridge = {
    subscribeTakodeEvents: (_sessions: unknown, callback: typeof receive) => {
      receive = callback;
      return () => {};
    },
    injectUserMessage: () => "no_session" as const,
    getSession: () => undefined,
    isSessionIdle: () => false,
    wakeIdleKilledSession: () => false,
  } satisfies WsBridgeHandle;
  const dispatcher = new HerdEventDispatcher(bridge, { getHerdedSessions: () => [{ sessionId: "worker" }] });
  dispatcher.setupForOrchestrator("leader");
  receive({
    id: 1,
    event: "turn_end",
    sessionId: "worker",
    ts: Date.now(),
    data: { reason: "result", duration_ms: 100 },
  } as TakodeEvent);
  vi.spyOn(serverWorkAdmission, "isStopping").mockReturnValue(true);
  expect(() => dispatcher.preservePendingForShutdown()).toThrow("have not reached durable pending input");
  expect(serverWorkAdmission.isPreservingQueuedWork()).toBe(false);
  dispatcher.destroy();
});
