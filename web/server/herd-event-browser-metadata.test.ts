import { describe, expect, it } from "vitest";
import { getTakodeHerdEventBrowserMetadata } from "./herd-event-browser-metadata.js";
import type { TakodeEvent, TakodeHerdBatchSnapshot } from "./session-types.js";

function turnEndEvent(overrides: Partial<Extract<TakodeEvent, { event: "turn_end" }>["data"]> = {}): TakodeEvent {
  return {
    id: 1,
    event: "turn_end",
    sessionId: "worker-1",
    sessionNum: 2444,
    sessionName: "Worker",
    ts: 1,
    data: {
      duration_ms: 1000,
      turn_source: "leader",
      msgRange: { from: 1, to: 2 },
      ...overrides,
    },
  };
}

function batch(events: TakodeEvent[]): TakodeHerdBatchSnapshot {
  return { events, renderedLines: events.map((event) => `#${event.sessionNum} | ${event.event}`) };
}

function boardStalledEvent(): TakodeEvent {
  return {
    id: 2,
    event: "board_stalled",
    sessionId: "worker-1",
    sessionNum: 2444,
    sessionName: "Worker",
    ts: 2,
    data: {
      questId: "q-1799",
      stage: "WORKING",
      stalledForMs: 240_000,
      reason: "worker disconnected",
    },
  };
}

describe("getTakodeHerdEventBrowserMetadata", () => {
  it("marks normal worker turn_end events as routine", () => {
    expect(getTakodeHerdEventBrowserMetadata(batch([turnEndEvent()]))).toEqual([
      { event: "turn_end", sessionId: "worker-1", sessionNum: 2444, ts: 1, routine: true },
    ]);
  });

  it("keeps interrupted and direct-user worker turns actionable", () => {
    const metadata = getTakodeHerdEventBrowserMetadata(
      batch([turnEndEvent({ interrupted: true, interrupt_source: "system" }), turnEndEvent({ turn_source: "user" })]),
    );

    expect(metadata?.map((event) => event.routine)).toEqual([false, false]);
    expect(metadata?.[0]?.lifecycle).toEqual(["interrupted"]);
    expect(metadata?.[1]?.lifecycle).toBeUndefined();
  });

  it("projects structured lifecycle labels for decision waits, resumptions, and compaction", () => {
    const metadata = getTakodeHerdEventBrowserMetadata(
      batch([
        turnEndEvent({ awaiting_decision: true }),
        turnEndEvent({ resumed_after_decision: true }),
        turnEndEvent({ compacted: true }),
      ]),
    );

    expect(metadata?.map((event) => event.lifecycle)).toEqual([
      ["waiting_for_decision"],
      ["resumed_after_decision"],
      ["context_continued"],
    ]);
    expect(metadata?.map((event) => event.routine)).toEqual([false, false, false]);
  });

  it("does not call interrupted compaction a successful context continuation", () => {
    const metadata = getTakodeHerdEventBrowserMetadata(
      batch([turnEndEvent({ compacted: true, interrupted: true, interrupt_source: "system" })]),
    );

    expect(metadata?.[0]?.lifecycle).toEqual(["interrupted"]);
  });

  it("only treats a disconnect as a Work interruption when generation was active", () => {
    const event = (wasGenerating: boolean): TakodeEvent => ({
      id: 3,
      event: "session_disconnected",
      sessionId: "worker-1",
      sessionNum: 2444,
      sessionName: "Worker",
      ts: 3,
      data: { wasGenerating, reason: wasGenerating ? "transport EOF" : "idle limit" },
    });
    const metadata = getTakodeHerdEventBrowserMetadata(batch([event(true), event(false)]));

    expect(metadata?.map((entry) => entry.lifecycle)).toEqual([["interrupted"], ["idle_disconnected"]]);
  });

  it("marks board stalled events as routine browser activity", () => {
    expect(getTakodeHerdEventBrowserMetadata(batch([boardStalledEvent()]))).toEqual([
      { event: "board_stalled", sessionId: "worker-1", sessionNum: 2444, ts: 2, routine: true },
    ]);
  });
});
