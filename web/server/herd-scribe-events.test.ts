import { afterEach, describe, expect, it } from "vitest";
import { isRoutineScribeEvent } from "./herd-event-dispatcher.js";
import { noteSessionError, noteTurnEnded, setScribeHooks } from "./scribe-registry.js";
import type { TakodeEvent } from "./session-types.js";

/**
 * A Scribe's routine activity never reaches its leader: its silent turns and its own lifecycle
 * (Takode archives and replaces Scribes by itself). Its questions, failures and replies still do,
 * and other workers' events are untouched.
 */

afterEach(() => setScribeHooks({ isScribe: () => false, turnEnded: () => {} }));

function event(sessionId: string, kind: string, data: Record<string, unknown> = {}): TakodeEvent {
  return { id: 1, event: kind, sessionId, sessionNum: 1, sessionName: "x", ts: 0, data } as unknown as TakodeEvent;
}

describe("isRoutineScribeEvent", () => {
  it("drops a Scribe's silent turns and lifecycle, and keeps what the leader must see", () => {
    setScribeHooks({ isScribe: (id) => id === "scribe", turnEnded: () => {} });
    expect(isRoutineScribeEvent(event("scribe", "turn_end", { quiet: { summary: "x", silent: true } }))).toBe(true);
    expect(isRoutineScribeEvent(event("scribe", "session_archived"))).toBe(true);
    expect(isRoutineScribeEvent(event("scribe", "turn_end", { quiet_ignored: "the turn asked a question" }))).toBe(
      false,
    );
    expect(isRoutineScribeEvent(event("scribe", "notification_needs_input"))).toBe(false);
    expect(isRoutineScribeEvent(event("worker", "turn_end", { quiet: { summary: "x", silent: true } }))).toBe(false);
  });
});

describe("noteTurnEnded", () => {
  it("tells the topic service only about Scribes' turn ends", async () => {
    // Every session's turn end passes through here; a Scribe's ends the request it worked on.
    const ended: string[] = [];
    const outcomes: boolean[] = [];
    setScribeHooks({
      isScribe: (id) => id === "scribe",
      turnEnded: (id, outcome) => {
        ended.push(id);
        outcomes.push(outcome.unfinished);
      },
    });
    noteTurnEnded("worker");
    noteTurnEnded("scribe", { reason: "result" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ended).toEqual(["scribe"]);
    // A stuck turn cleared by the watchdog or a disconnect did not finish; a provisional end is no end.
    noteTurnEnded("scribe", { reason: "stuck_auto_recovery", interrupted: true });
    noteTurnEnded("scribe", { reason: "cli_disconnect" });
    noteTurnEnded("scribe", { reason: "x", provisional: true });
    // A turn Restart Server interrupted is continued after the restart, so it neither failed nor ended.
    noteTurnEnded("scribe", { reason: "result", interrupted: true, interrupt_origin: "restart_prep" });
    // A failed Claude turn ends with a plain result, and its error follows at once.
    noteTurnEnded("scribe", { reason: "result" });
    noteSessionError("scribe");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes).toEqual([false, true, true, true]);
  });
});
