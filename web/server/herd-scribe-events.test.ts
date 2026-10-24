import { afterEach, describe, expect, it } from "vitest";
import { isRoutineScribeEvent } from "./herd-event-dispatcher.js";
import { setScribeLookup } from "./scribe-registry.js";
import type { TakodeEvent } from "./session-types.js";

/**
 * A Scribe's routine activity never reaches its leader: its silent turns and its own lifecycle
 * (Takode archives and replaces Scribes by itself). Its questions, failures and replies still do,
 * and other workers' events are untouched.
 */

afterEach(() => setScribeLookup(() => false));

function event(sessionId: string, kind: string, data: Record<string, unknown> = {}): TakodeEvent {
  return { id: 1, event: kind, sessionId, sessionNum: 1, sessionName: "x", ts: 0, data } as unknown as TakodeEvent;
}

describe("isRoutineScribeEvent", () => {
  it("drops a Scribe's silent turns and lifecycle, and keeps what the leader must see", () => {
    setScribeLookup((id) => id === "scribe");
    expect(isRoutineScribeEvent(event("scribe", "turn_end", { quiet: { summary: "x", silent: true } }))).toBe(true);
    expect(isRoutineScribeEvent(event("scribe", "session_archived"))).toBe(true);
    expect(isRoutineScribeEvent(event("scribe", "turn_end", { quiet_ignored: "the turn asked a question" }))).toBe(
      false,
    );
    expect(isRoutineScribeEvent(event("scribe", "notification_needs_input"))).toBe(false);
    expect(isRoutineScribeEvent(event("worker", "turn_end", { quiet: { summary: "x", silent: true } }))).toBe(false);
  });
});
