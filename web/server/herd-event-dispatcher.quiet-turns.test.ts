/**
 * Tests for held quiet turns in the herd dispatcher: a worker turn that ended with
 * an accepted quiet marker never wakes the leader on its own, folds into one line
 * per worker, and rides along with the next real event for the same thread.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";
import { createMocks, makeEvent, triggerEvent } from "./herd-event-dispatcher.test-helpers.js";
import type { BoardRow, TakodeEvent } from "./session-types.js";

function quietTurn(id: number, summary: string, overrides: Partial<TakodeEvent> = {}): TakodeEvent {
  return makeEvent({
    id,
    data: { duration_ms: 1000, reason: "result", quiet: { summary }, msgRange: { from: id * 10, to: id * 10 + 5 } },
    ...overrides,
  } as Partial<TakodeEvent>);
}

function setup() {
  const { bridge, launcher } = createMocks();
  vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
  // Both workers belong to the same quest thread unless a test says otherwise.
  vi.mocked(launcher.getSession!).mockReturnValue({ claimedQuestId: "q-101" });
  const dispatcher = new HerdEventDispatcher(bridge, launcher);
  dispatcher.setupForOrchestrator("orch-1");
  return { bridge, launcher, dispatcher };
}

describe("HerdEventDispatcher quiet turns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a quiet turn without waking an idle leader", () => {
    // The whole point: an idle leader is not woken for a turn the worker marked quiet.
    const { bridge, dispatcher } = setup();

    triggerEvent(quietTurn(1, "2 PM check, nothing new"));
    vi.advanceTimersByTime(5_000);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(dispatcher.getDiagnostics("orch-1").pendingEventCount).toBe(1);
    dispatcher.destroy();
  });

  it("merges a worker's held quiet turns and delivers them with the next real event in the thread", () => {
    // Several quiet runs from one worker become one line with a count and the
    // latest summary, placed before the real event that finally wakes the leader.
    const { bridge, dispatcher } = setup();

    triggerEvent(quietTurn(1, "1 PM check, nothing new"));
    triggerEvent(quietTurn(2, "2 PM check, nothing new"));
    vi.advanceTimersByTime(5_000);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    triggerEvent(
      makeEvent({
        id: 3,
        sessionId: "worker-2",
        sessionNum: 6,
        data: { duration_ms: 2000, reason: "result", resultPreview: "Reviewer replied" },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("2 events from 2 sessions");
    expect(content).toContain("#5 | turn_end | quiet | 2 quiet turns, latest: 2 PM check, nothing new");
    expect(content).not.toContain("1 PM check");
    expect(content.indexOf("#5 | turn_end | quiet")).toBeLessThan(content.indexOf("#6 | turn_end"));
    dispatcher.destroy();
  });

  it("keeps a quiet turn held when the real event belongs to another thread", () => {
    // Each thread's batch starts its own leader turn, so a quiet line never
    // triggers one: it waits for a real event in its own thread.
    const { bridge, launcher, dispatcher } = setup();
    vi.mocked(launcher.getSession!).mockImplementation((sessionId) =>
      sessionId === "worker-1" ? { claimedQuestId: "q-101" } : { claimedQuestId: "q-202" },
    );

    triggerEvent(quietTurn(1, "watch check, nothing new"));
    triggerEvent(makeEvent({ id: 2, sessionId: "worker-2", sessionNum: 6, data: { duration_ms: 2000 } }));
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]?.threadKey).toBe("q-202");
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][1]).not.toContain("quiet");
    expect(dispatcher.getDiagnostics("orch-1").pendingEventCount).toBe(1);
    dispatcher.destroy();
  });

  it("delivers a quiet turn normally when the worker's board row changed during the turn", () => {
    // A Journey transition (e.g. Work -> Memory) bumps the row; the leader must see it.
    const { bridge, dispatcher } = setup();
    const now = Date.now();
    const row: BoardRow = { questId: "q-101", worker: "worker-1", createdAt: now - 60_000, updatedAt: now - 200 };
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "orch-1"
        ? ({ board: new Map([["q-101", row]]), messageHistory: [] } as unknown as ReturnType<typeof bridge.getSession>)
        : undefined,
    );

    triggerEvent(quietTurn(1, "phase moved", { ts: now }));
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][1]).toContain(
      "quiet marker ignored: the quest's board row changed",
    );
    dispatcher.destroy();
  });

  it("still holds a quiet turn when the worker's board row is older than the turn", () => {
    // The normal eligible path next to the override above.
    const { bridge, dispatcher } = setup();
    const now = Date.now();
    const row: BoardRow = { questId: "q-101", worker: "worker-1", createdAt: now - 60_000, updatedAt: now - 30_000 };
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "orch-1"
        ? ({ board: new Map([["q-101", row]]), messageHistory: [] } as unknown as ReturnType<typeof bridge.getSession>)
        : undefined,
    );

    triggerEvent(quietTurn(1, "nothing new", { ts: now }));
    vi.advanceTimersByTime(5_000);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    dispatcher.destroy();
  });
});
