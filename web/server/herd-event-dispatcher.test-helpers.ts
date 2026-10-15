// Mock bridge, launcher and event helpers shared by the HerdEventDispatcher test files.
import { vi } from "vitest";
import type { LauncherHandle, WsBridgeHandle } from "./herd-event-dispatcher.js";
import type { TakodeEvent } from "./session-types.js";

export function makeEvent(overrides: Partial<TakodeEvent> = {}): TakodeEvent {
  return {
    id: 1,
    event: "turn_end",
    sessionId: "worker-1",
    sessionNum: 5,
    sessionName: "auth-module",
    ts: Date.now(),
    data: { duration_ms: 1000, reason: "test" },
    ...overrides,
  } as TakodeEvent;
}

let eventCallback: ((evt: TakodeEvent) => void) | null = null;

/** A bridge and launcher herding worker-1 and worker-2; `triggerEvent` feeds the bridge's subscription. */
export function createMocks() {
  eventCallback = null;
  const bridge = {
    subscribeTakodeEvents: vi.fn<WsBridgeHandle["subscribeTakodeEvents"]>((sessions, cb) => {
      eventCallback = (evt) => {
        if (sessions.has(evt.sessionId)) cb(evt);
      };
      return vi.fn(); // unsubscribe
    }),
    injectUserMessage: vi.fn<WsBridgeHandle["injectUserMessage"]>(() => "sent"),
    isSessionIdle: vi.fn<NonNullable<WsBridgeHandle["isSessionIdle"]>>(() => false),
    wakeIdleKilledSession: vi.fn<NonNullable<WsBridgeHandle["wakeIdleKilledSession"]>>(() => false),
    getSession: vi.fn<WsBridgeHandle["getSession"]>(() => undefined),
    getBoardRow: vi.fn<NonNullable<WsBridgeHandle["getBoardRow"]>>(() => ({ status: "IMPLEMENTING" })),
    getBoardStallSignature: vi.fn<NonNullable<WsBridgeHandle["getBoardStallSignature"]>>(() => "sig-1"),
    getBoardDispatchableSignature: vi.fn<NonNullable<WsBridgeHandle["getBoardDispatchableSignature"]>>(
      () => "dispatchable-sig-1",
    ),
  } satisfies WsBridgeHandle;
  const launcher: LauncherHandle = {
    getHerdedSessions: vi.fn(() => [{ sessionId: "worker-1" }, { sessionId: "worker-2" }]),
    getSession: vi.fn(() => undefined),
  };
  return { bridge, launcher };
}

export function triggerEvent(evt: TakodeEvent) {
  eventCallback?.(evt);
}
