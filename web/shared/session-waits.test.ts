import { describe, expect, it } from "vitest";
import {
  SESSION_WAITS_MAX_COUNT,
  SESSION_WAIT_TEXT_MAX_LENGTH,
  boundSessionWaits,
  isSessionWaitList,
  primarySessionWaitKind,
  sessionWaitsEqual,
  type SessionWait,
} from "./session-waits.js";

// The `waits` list travels in the session navigation projection, which every
// browser validates and diffs. These tests cover what keeps it well-formed and
// cheap to sync, and which wait leads the icons.
const job: SessionWait = { kind: "job", description: "Run full gate", startedAt: 5 };
const queue: SessionWait = { kind: "queue", resource: "agent-browser", position: 2 };

describe("session waits", () => {
  it("accepts each wait kind and rejects malformed entries", () => {
    expect(isSessionWaitList([{ kind: "answer", questId: "q-1" }, job, { kind: "landing" }, queue])).toBe(true);
    expect(isSessionWaitList([{ kind: "queue", resource: "x", position: 0 }])).toBe(false);
    expect(isSessionWaitList([{ kind: "job", description: "x" }])).toBe(false);
    expect(isSessionWaitList([{ kind: "landing", extra: true }])).toBe(false);
    expect(isSessionWaitList([{ kind: "timer" }])).toBe(false);
    expect(isSessionWaitList(null)).toBe(false);
  });

  it("clips a long list and long text to the bounds the validator enforces", () => {
    const many = Array.from({ length: SESSION_WAITS_MAX_COUNT + 3 }, () => ({
      ...job,
      description: "x".repeat(SESSION_WAIT_TEXT_MAX_LENGTH + 10),
    }));
    const bounded = boundSessionWaits(many);
    expect(bounded).toHaveLength(SESSION_WAITS_MAX_COUNT);
    expect(isSessionWaitList(bounded)).toBe(true);
  });

  it("compares lists by content, since the server rebuilds them on every publish", () => {
    expect(sessionWaitsEqual([job, queue], [{ ...job }, { ...queue }])).toBe(true);
    expect(sessionWaitsEqual([job], [{ ...job, startedAt: 6 }])).toBe(false);
    expect(sessionWaitsEqual([job, queue], [queue, job])).toBe(false);
  });

  it("leads with the first reported wait, else timers", () => {
    // A background job outranks a pending timer, so a worker waiting on its own
    // job does not show the timer clock.
    expect(primarySessionWaitKind(1, [job])).toBe("job");
    expect(primarySessionWaitKind(2, [])).toBe("timer");
    expect(primarySessionWaitKind(0, null)).toBeNull();
  });
});
