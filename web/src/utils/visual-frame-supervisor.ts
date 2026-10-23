/**
 * Supervises every visual frame on the page.
 *
 * Chrome runs sandboxed frames outside Takode's process, but by default it puts all of
 * a page's sandboxed frames into one shared process. So a single visual stuck in a
 * loop freezes every other visual too (never Takode itself), and removing only that
 * frame does not unfreeze the rest: the shared process stays busy until every frame
 * in it is gone. Measured with Chrome 155 (q-2830).
 *
 * The supervisor therefore:
 * - loads one frame at a time, so a frame that never becomes ready is clearly the one
 *   to blame;
 * - when a visual hangs, crashes or keeps the processor busy, stops it and briefly
 *   unloads every other frame, which ends the shared process, then loads the others
 *   again one by one;
 * - when frames stall with no clear culprit, reloads them one by one on probation and
 *   stops the one that stalls again.
 */

export interface SupervisedFrame {
  /** Show or remove the frame's iframe. */
  setMounted(mounted: boolean): void;
  /** The visual was stopped; `reason` finishes "Stopped on this device because …". */
  stop(reason: string): void;
  /** Running in the page's own process (Safari after an explicit tap): also watch the page's own lag. */
  sameProcess?: boolean;
}

export interface FrameHandle {
  /** Feed a message from the frame's script: `ready`, `beat` (with `lag`) or `size`. */
  message(kind: string, lag?: number): void;
  unregister(): void;
}

export const VISUAL_TIMING = {
  readyTimeoutMs: 8000,
  beatGapMs: 3000,
  busyWindowMs: 6000,
  busyLagMs: 4500,
  // Longer than beatGapMs, so a frame that stalls during its trial is seen stalling before it passes.
  probationMs: 4500,
  remountDelayMs: 120,
  tickMs: 500,
};

type State = "queued" | "loading" | "ready" | "probation";

interface Entry {
  id: number;
  frame: SupervisedFrame;
  state: State;
  /** Loaded again after an unexplained stall: stalling once more blames it. */
  suspect: boolean;
  mountedAt: number;
  readyAt: number;
  lastBeat: number;
  lags: Array<{ at: number; lag: number }>;
}

export class VisualFrameSupervisor {
  private readonly entries: Entry[] = [];
  private nextId = 0;
  private resetting = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  /** Smoothed time between the page's animation frames; high means the page is janking. */
  private frameGap = 16;
  private lastFrame = 0;
  private slowSince = 0;
  private frameLoop = false;

  constructor(
    private readonly clock: {
      now(): number;
      setTimeout(fn: () => void, ms: number): unknown;
      setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
      clearInterval(id: ReturnType<typeof setInterval>): void;
      requestFrame?(fn: () => void): void;
      visible(): boolean;
    },
  ) {}

  register(frame: SupervisedFrame): FrameHandle {
    const entry: Entry = {
      id: this.nextId++,
      frame,
      state: "queued",
      suspect: false,
      mountedAt: 0,
      readyAt: 0,
      lastBeat: 0,
      lags: [],
    };
    this.entries.push(entry);
    this.ensureTimer();
    this.pump();
    return {
      message: (kind, lag) => this.onMessage(entry, kind, lag),
      unregister: () => this.remove(entry),
    };
  }

  /** Each registered frame's state, for tests and debugging. */
  describe(): Array<{ state: State; suspect: boolean }> {
    return this.entries.map((entry) => ({ state: entry.state, suspect: entry.suspect }));
  }

  private onMessage(entry: Entry, kind: string, lag = 0): void {
    if (!this.entries.includes(entry) || entry.state === "queued") return;
    const now = this.clock.now();
    entry.lastBeat = now;
    if (kind === "ready" && entry.state === "loading") {
      entry.readyAt = now;
      entry.state = entry.suspect ? "probation" : "ready";
      if (entry.state === "ready") this.pump();
      return;
    }
    if (kind !== "beat") return;
    entry.lags.push({ at: now, lag: Math.min(lag, VISUAL_TIMING.busyWindowMs) });
    while (entry.lags.length && entry.lags[0]!.at < now - VISUAL_TIMING.busyWindowMs) entry.lags.shift();
    const busy = entry.lags.reduce((sum, item) => sum + item.lag, 0);
    if (entry.state !== "loading" && busy > VISUAL_TIMING.busyLagMs) {
      this.blame(entry, "it kept the processor busy");
    }
  }

  private tick(): void {
    const now = this.clock.now();
    const timerGap = now - this.lastTick;
    this.lastTick = now;
    const sameProcess = this.entries.some((entry) => entry.frame.sameProcess && entry.state !== "queued");
    if (!this.clock.visible()) {
      // Hidden pages throttle timers; don't read that as a hang.
      for (const entry of this.entries) entry.lastBeat = now;
      this.slowSince = 0;
      this.frameGap = 16;
      return;
    }
    const mounted = this.entries.filter((entry) => entry.state !== "queued");
    const loading = mounted.find((entry) => entry.state === "loading");
    if (sameProcess) {
      // A visual in the page's own process slows the page itself: late timers, or animation
      // frames far apart (a busy frame loop starves timers, so frames are measured too).
      const slow = timerGap > VISUAL_TIMING.tickMs * 3 || this.frameGap > 70;
      this.slowSince = slow ? this.slowSince || now : 0;
      // Frames load one at a time, so the newest one is the likely cause.
      const culprit =
        loading ??
        mounted
          .filter((entry) => entry.frame.sameProcess)
          .reduce<Entry | undefined>(
            (newest, entry) => (!newest || entry.mountedAt > newest.mountedAt ? entry : newest),
            undefined,
          );
      if (culprit && this.slowSince && now - this.slowSince > 1500) {
        this.slowSince = 0;
        return this.blame(culprit, "it slowed Takode down");
      }
    }
    if (loading && now - loading.mountedAt > VISUAL_TIMING.readyTimeoutMs) {
      return this.blame(loading, "it never finished loading");
    }
    const stalled = mounted.filter(
      (entry) => entry.state !== "loading" && now - entry.lastBeat > VISUAL_TIMING.beatGapMs,
    );
    if (stalled.length) {
      const probation = mounted.find((entry) => entry.state === "probation");
      // One frame at a time is on trial or loading, so if anything stalls now, it is the cause.
      const culprit = loading ?? probation ?? (mounted.length === 1 ? mounted[0] : undefined);
      if (culprit) return this.blame(culprit, "it stopped responding");
      // Several frames stalled together and none is new: reload them one by one on probation.
      for (const entry of stalled) entry.suspect = true;
      return this.reset();
    }
    for (const entry of mounted) {
      if (entry.state === "probation" && now - entry.readyAt > VISUAL_TIMING.probationMs) {
        entry.state = "ready";
        entry.suspect = false;
        this.pump();
      }
    }
  }

  /** Stop the culprit, then unload and reload the rest, which ends the process they shared with it. */
  private blame(entry: Entry, reason: string): void {
    this.remove(entry);
    entry.frame.setMounted(false);
    entry.frame.stop(reason);
    this.reset();
  }

  private reset(): void {
    this.resetting = true;
    for (const entry of this.entries) {
      if (entry.state === "queued") continue;
      entry.frame.setMounted(false);
      entry.state = "queued";
      entry.lags = [];
    }
    this.clock.setTimeout(() => {
      this.resetting = false;
      this.pump();
    }, VISUAL_TIMING.remountDelayMs);
  }

  /** Load the next waiting frame when nothing is loading or on probation. */
  private pump(): void {
    if (this.resetting) return;
    if (this.entries.some((entry) => entry.state === "loading" || entry.state === "probation")) return;
    const next = this.entries.find((entry) => entry.state === "queued");
    if (!next) return;
    const now = this.clock.now();
    next.state = "loading";
    next.mountedAt = now;
    next.lastBeat = now;
    next.frame.setMounted(true);
  }

  private remove(entry: Entry): void {
    const index = this.entries.indexOf(entry);
    if (index < 0) return;
    this.entries.splice(index, 1);
    if (entry.state === "loading" || entry.state === "probation") this.pump();
    if (!this.entries.length && this.timer) {
      this.clock.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.lastTick = this.clock.now();
    this.timer = this.clock.setInterval(() => this.tick(), VISUAL_TIMING.tickMs);
    this.startFrameLoop();
  }

  /**
   * Animation frames also drive the checks: in Safari a visual's busy frame loop can starve
   * the page's timers almost completely while frames still come, just late.
   */
  private startFrameLoop(): void {
    const requestFrame = this.clock.requestFrame;
    if (this.frameLoop || !requestFrame) return;
    this.frameLoop = true;
    this.lastFrame = this.clock.now();
    const onFrame = () => {
      if (!this.timer) {
        this.frameLoop = false;
        return;
      }
      const now = this.clock.now();
      this.frameGap = this.frameGap * 0.8 + Math.min(now - this.lastFrame, 2000) * 0.2;
      this.lastFrame = now;
      if (now - this.lastTick >= VISUAL_TIMING.tickMs) this.tick();
      requestFrame(onFrame);
    };
    requestFrame(onFrame);
  }
}

let shared: VisualFrameSupervisor | null = null;

/** The page's supervisor. */
export function visualFrameSupervisor(): VisualFrameSupervisor {
  shared ??= new VisualFrameSupervisor({
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    setInterval: (fn, ms) => window.setInterval(fn, ms) as unknown as ReturnType<typeof setInterval>,
    clearInterval: (id) => window.clearInterval(id as unknown as number),
    visible: () => document.visibilityState === "visible",
    requestFrame: (fn) => window.requestAnimationFrame(fn),
  });
  (window as unknown as { __takodeVisualSupervisor?: VisualFrameSupervisor }).__takodeVisualSupervisor = shared;
  return shared;
}
