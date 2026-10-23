import { describe, expect, it } from "vitest";
import { VISUAL_TIMING, VisualFrameSupervisor, type SupervisedFrame } from "./visual-frame-supervisor.js";

/** A manual clock: timers run only when the test advances time. */
function harness() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void; every?: number }> = [];
  const supervisor = new VisualFrameSupervisor({
    now: () => now,
    setTimeout: (fn, ms) => timers.push({ at: now + ms, fn }),
    setInterval: (fn, ms) => {
      const timer = { at: now + ms, fn, every: ms };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (id) => {
      timers = timers.filter((timer) => timer !== (id as unknown));
    },
    visible: () => true,
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      if (next.every) next.at += next.every;
      else timers = timers.filter((timer) => timer !== next);
      next.fn();
    }
    now = end;
  };
  const frames: Array<SupervisedFrame & { name: string; mounted: boolean; stopped: string | null }> = [];
  const add = (name: string) => {
    const frame = {
      name,
      mounted: false,
      stopped: null as string | null,
      setMounted(value: boolean) {
        frame.mounted = value;
      },
      stop(reason: string) {
        frame.stopped = reason;
      },
    };
    frames.push(frame);
    return { frame, handle: supervisor.register(frame) };
  };
  return { supervisor, advance, add, frames };
}

describe("VisualFrameSupervisor", () => {
  it("loads frames one at a time", () => {
    // A frame that never becomes ready must be the only one loading, so blame is unambiguous.
    const { add } = harness();
    const a = add("a");
    const b = add("b");
    expect(a.frame.mounted).toBe(true);
    expect(b.frame.mounted).toBe(false);
    a.handle.message("ready");
    expect(b.frame.mounted).toBe(true);
  });

  it("stops a frame that never gets ready and reloads the frames that shared its process", () => {
    const { add, advance } = harness();
    const good = add("good");
    good.handle.message("ready");
    const stuck = add("stuck");
    expect(stuck.frame.mounted).toBe(true);
    // The good frame keeps beating at first, then stalls with the shared process.
    advance(2000);
    good.handle.message("beat", 0);
    advance(VISUAL_TIMING.beatGapMs + 600);
    expect(stuck.frame.stopped).toMatch(/stopped responding/);
    // Every frame was unloaded to end the frozen process, then the good one comes back.
    expect(good.frame.mounted).toBe(false);
    advance(VISUAL_TIMING.remountDelayMs + 1);
    expect(good.frame.mounted).toBe(true);
    expect(good.frame.stopped).toBeNull();
  });

  it("blames a loading frame after the ready timeout even when nothing else is mounted", () => {
    const { add, advance } = harness();
    const stuck = add("stuck");
    advance(VISUAL_TIMING.readyTimeoutMs + VISUAL_TIMING.tickMs);
    expect(stuck.frame.stopped).toMatch(/never finished loading/);
  });

  it("stops a frame that reports it keeps the processor busy", () => {
    const { add, advance } = harness();
    const busy = add("busy");
    busy.handle.message("ready");
    for (let i = 0; i < 12; i++) {
      advance(250);
      busy.handle.message("beat", 450);
    }
    expect(busy.frame.stopped).toMatch(/processor busy/);
  });

  it("reloads frames that stalled together on probation and stops the one that stalls again", () => {
    const { add, advance } = harness();
    const a = add("a");
    a.handle.message("ready");
    const b = add("b");
    b.handle.message("ready");
    // Both ready, both stop beating: no frame is new, so nothing is blamed yet.
    advance(VISUAL_TIMING.beatGapMs + VISUAL_TIMING.tickMs);
    expect(a.frame.stopped).toBeNull();
    expect(b.frame.stopped).toBeNull();
    advance(VISUAL_TIMING.remountDelayMs + 1);
    // On probation they load one by one; a passes its probation, b stalls during its own.
    expect(a.frame.mounted).toBe(true);
    expect(b.frame.mounted).toBe(false);
    a.handle.message("ready");
    for (let t = 0; t < VISUAL_TIMING.probationMs + VISUAL_TIMING.tickMs; t += 250) {
      advance(250);
      a.handle.message("beat", 0);
    }
    expect(b.frame.mounted).toBe(true);
    b.handle.message("ready");
    for (let t = 0; t < VISUAL_TIMING.beatGapMs + VISUAL_TIMING.tickMs; t += 250) {
      advance(250);
      a.handle.message("beat", 0);
    }
    expect(b.frame.stopped).toMatch(/stopped responding/);
    expect(a.frame.stopped).toBeNull();
  });
});
