/**
 * Decides when the living Ink & Paper scene moves and when it rests, so it never runs as a
 * visible loop:
 * - The ambient motion (the sea of clouds, the lake) runs on a scene clock that slows while you
 *   type, scroll or a new reply arrives, and drifts on again once you pause.
 * - Moments (a few cranes crossing, a fish ring on the lake) come from a seeded random schedule
 *   counted in idle time only: a crane flight every few minutes, a ring now and then. None starts
 *   while you are busy.
 * - Cranes are small and far away, glide far more than they beat their wings, and always fly in
 *   past one edge and out past the other, on a different path, height, direction and number each
 *   time, slowly enough to read as part of the painting rather than as something on the screen.
 */

export type ActivityKind = "typing" | "scrolling" | "message";
export type MomentKind = "cranes" | "ring";

/** How long the scene stays calm after each kind of activity, in seconds. */
const CALM_FOR: Record<ActivityKind, number> = { typing: 6, scrolling: 4, message: 12 };
/** Ambient speed while calm: the mist keeps flowing visibly, a little slower; only moments wait. */
const CALM_RATE = 0.6;
/** Idle seconds needed before a moment may begin. */
const SETTLE = 15;

export interface CraneFlight {
  start: number;
  /** +1 flies left to right, -1 right to left. */
  direction: 1 | -1;
  /** Heights at entry and exit, as fractions of the pane height. */
  fromY: number;
  toY: number;
  /** Pixels per second. */
  speed: number;
  /** Lead crane width as a fraction of the pane width. */
  size: number;
  /** Each crane's offset behind the lead (in lead widths), scale and wingbeat seed. */
  birds: Array<{ dx: number; dy: number; scale: number; seed: number; glide: number }>;
}

export interface Ring {
  x: number;
  /** Depth below the lake line, as a fraction of the pane height. */
  depth: number;
  start: number;
}

export interface DirectorFrame {
  /** Seconds on the scene clock, which slows while you work. */
  sceneTime: number;
  cranes: CraneFlight[];
  rings: Ring[];
}

/** Small, fast, seeded random numbers, so a preview can replay the same evening. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export class InkDirector {
  private readonly rand: () => number;
  private last: number | null = null;
  private sceneTime: number;
  private rate = 1;
  private calmUntil = Number.NEGATIVE_INFINITY;
  private idle = 0;
  private nextCrane: number;
  private nextRing: number;
  private cranes: CraneFlight[] = [];
  private rings: Ring[] = [];

  constructor(seed: number, sceneStart = 0) {
    this.rand = random(seed);
    this.sceneTime = sceneStart;
    // The first moments come a little sooner than later ones, so the scene shows it is alive.
    this.nextCrane = this.between(40, 90);
    this.nextRing = this.between(10, 30);
  }

  /** Something the person did; the ambient motion hushes and moments wait. */
  noteActivity(kind: ActivityKind, now: number) {
    this.calmUntil = Math.max(this.calmUntil, now + CALM_FOR[kind]);
    this.idle = 0;
  }

  /** Starts a moment right away (the Playground's buttons). */
  spawn(kind: MomentKind, now: number) {
    if (kind === "cranes") this.cranes.push(this.flight(now));
    if (kind === "ring")
      this.rings.push({ x: this.between(0.15, 0.85), depth: this.between(0.03, 0.12), start: this.sceneTime });
  }

  /** Advances to `now` (seconds) for a pane `width` wide and returns what to draw. */
  update(now: number, width: number, height: number): DirectorFrame {
    // A hidden tab or a stall resumes where it left off instead of jumping ahead.
    const dt = this.last === null ? 0 : Math.min(0.5, Math.max(0, now - this.last));
    this.last = now;
    const calm = now < this.calmUntil;
    const target = calm ? CALM_RATE : 1;
    // Hush within about a second; wake gently over a few seconds.
    this.rate += (target - this.rate) * Math.min(1, dt * (calm ? 2.5 : 0.5));
    this.sceneTime += dt * this.rate;
    if (!calm) this.idle += dt;
    if (this.idle >= SETTLE) {
      this.nextCrane -= dt;
      this.nextRing -= dt;
      if (this.nextCrane <= 0) {
        this.cranes.push(this.flight(now));
        this.nextCrane = this.between(180, 420);
      }
      if (this.nextRing <= 0) {
        this.rings.push({ x: this.between(0.08, 0.92), depth: this.between(0.03, 0.14), start: this.sceneTime });
        this.nextRing = this.between(25, 70);
      }
    }
    this.cranes = this.cranes.filter((flight) => !flightDone(flight, now, width, height));
    this.rings = this.rings.filter((ring) => this.sceneTime - ring.start < 9);
    return { sceneTime: this.sceneTime, cranes: this.cranes, rings: this.rings };
  }

  private between(low: number, high: number) {
    return low + (high - low) * this.rand();
  }

  private flight(now: number): CraneFlight {
    const roll = this.rand();
    const count = roll < 0.4 ? 1 : roll < 0.75 ? 2 : 3;
    const fromY = this.between(0.1, 0.28);
    const formation = [
      { dx: 0, dy: 0 },
      { dx: 1.1, dy: this.between(0.2, 0.45) },
      { dx: 2.1, dy: this.between(-0.25, 0.1) },
    ];
    return {
      start: now,
      direction: this.rand() < 0.5 ? 1 : -1,
      fromY,
      toY: Math.min(0.32, Math.max(0.08, fromY + this.between(-0.07, 0.07))),
      speed: this.between(11, 16),
      size: this.between(0.032, 0.042),
      birds: formation.slice(0, count).map((offset, index) => ({
        ...offset,
        scale: index === 0 ? 1 : this.between(0.78, 0.92),
        seed: this.between(0, 10),
        glide: this.between(6, 10),
      })),
    };
  }
}

/** Lead crane width in pixels for a pane, small enough to belong to the painting. */
export function craneWidth(flight: CraneFlight, width: number) {
  return Math.min(56, Math.max(28, width * flight.size));
}

/** Where a flight's lead crane is: x in pixels, and how far along (0 entering, 1 leaving). */
export function flightPosition(flight: CraneFlight, now: number, width: number) {
  const lead = craneWidth(flight, width);
  // Enter fully outside one edge and leave fully outside the other, the whole flock included.
  const span = width + lead * 4.5;
  const travelled = (now - flight.start) * flight.speed;
  const along = Math.min(1, travelled / span);
  const x = flight.direction === -1 ? width + lead * 0.75 - travelled : -lead * 0.75 + travelled;
  return { x, along };
}

function flightDone(flight: CraneFlight, now: number, width: number, _height: number) {
  return (now - flight.start) * flight.speed > width + craneWidth(flight, width) * 4.5;
}
