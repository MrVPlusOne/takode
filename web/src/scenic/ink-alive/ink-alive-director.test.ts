/**
 * The living Ink & Paper director and layout: cranes never pop in or out inside the pane, nothing
 * starts while the person is busy, moments stay rare, and the scene hushes while they work.
 */
import { describe, expect, it } from "vitest";
import { type ActivityKind, InkDirector } from "./ink-alive-director.js";
import { layoutScene } from "./ink-alive-layout.js";

const IMAGES = {
  far: { width: 1536, height: 258 },
  midFar: { width: 1536, height: 436 },
  mid: { width: 1536, height: 684 },
  near: { width: 1536, height: 968 },
  boat: { width: 695, height: 179 },
  crane: { width: 1686, height: 260 },
};

/** Runs a director for `seconds` in 0.1 s steps, calling `busy` to decide each step's activity. */
function run(
  director: InkDirector,
  seconds: number,
  busy?: (t: number) => ActivityKind | null,
  pane = { width: 1100, height: 1000 },
) {
  const frames = [];
  for (let t = 0; t <= seconds; t += 0.1) {
    const kind = busy?.(t);
    if (kind) director.noteActivity(kind, t);
    frames.push({ t, frame: director.update(t, pane.width, pane.height) });
  }
  return frames;
}

/** Every crane drawn in a frame, as [left, right, top, bottom] in pane pixels. */
function craneBoxes(t: number, frame: ReturnType<InkDirector["update"]>, pane: { width: number; height: number }) {
  const rects = layoutScene(pane, IMAGES, t, frame).craneRects;
  const boxes = [];
  for (let i = 0; i < rects.length; i += 4) {
    const [x, y, w, h] = rects.slice(i, i + 4) as [number, number, number, number];
    if (x < -1e4) continue;
    boxes.push([x - Math.abs(w) / 2, x + Math.abs(w) / 2, y - h / 2, y + h / 2]);
  }
  return boxes;
}

describe("InkDirector", () => {
  it("brings cranes in past one edge and takes them out past the other, never appearing or vanishing inside the pane", () => {
    // Many flights over several pane shapes: each crane's first and last drawn frame must be
    // fully outside the pane, so it can only enter or leave across an edge.
    for (const pane of [
      { width: 1100, height: 1000 },
      { width: 1700, height: 1000 },
      { width: 430, height: 930 },
    ]) {
      for (let seed = 1; seed <= 12; seed++) {
        const director = new InkDirector(seed);
        director.spawn("cranes", 0);
        const flight = director.update(0, pane.width, pane.height).cranes[0]!;
        const seen: number[][][] = [];
        for (let t = 0; t <= 400; t += 0.25) {
          const frame = director.update(t, pane.width, pane.height);
          // Follow this one flight; the regular schedule may send another meanwhile.
          if (!frame.cranes.includes(flight)) break;
          seen.push(craneBoxes(t, { ...frame, cranes: [flight] }, pane));
        }
        expect(seen.length).toBeGreaterThan(0);
        const outside = (box: number[]) => box[1]! <= 0 || box[0]! >= pane.width;
        for (const box of seen[0]!) expect(outside(box)).toBe(true);
        for (const box of seen[seen.length - 1]!) expect(outside(box)).toBe(true);
      }
    }
  });

  it("starts nothing while the person keeps working", () => {
    const director = new InkDirector(7);
    const frames = run(director, 20 * 60, () => "typing");
    const last = frames[frames.length - 1]!.frame;
    expect(last.cranes).toHaveLength(0);
    expect(last.blooms).toHaveLength(0);
    expect(last.rings).toHaveLength(0);
  });

  it("keeps crane flights rare: a few in half an hour of quiet", () => {
    const director = new InkDirector(11);
    const flights = new Set<object>();
    for (const { frame } of run(director, 30 * 60)) for (const flight of frame.cranes) flights.add(flight);
    expect(flights.size).toBeGreaterThanOrEqual(3);
    expect(flights.size).toBeLessThanOrEqual(10);
  });

  it("hushes the ambient motion within a second or two of typing and wakes again after a pause", () => {
    const director = new InkDirector(3);
    // Type from 10 s to 20 s, then rest.
    const frames = run(director, 40, (t) => (t >= 10 && t < 20 ? "typing" : null));
    const rateAt = (t: number) => {
      const i = Math.round(t / 0.1);
      return (frames[i + 1]!.frame.sceneTime - frames[i]!.frame.sceneTime) / 0.1;
    };
    expect(rateAt(5)).toBeGreaterThan(0.95);
    expect(rateAt(12)).toBeLessThan(0.3);
    expect(rateAt(24)).toBeLessThan(0.3);
    expect(rateAt(38)).toBeGreaterThan(0.9);
  });
});

describe("layoutScene", () => {
  it("keeps the sun inside the conversation pane at any width, so the side column never hides it", () => {
    for (const pane of [
      { width: 1100, height: 1030 },
      { width: 1450, height: 1040 },
      { width: 2400, height: 1300 },
      { width: 430, height: 930 },
    ]) {
      const [x, y, r] = layoutScene(pane, IMAGES, 0, new InkDirector(1).update(0, pane.width, pane.height)).sun;
      expect(x - r).toBeGreaterThan(0);
      expect(x + r).toBeLessThan(pane.width);
      expect(y - r).toBeGreaterThan(0);
    }
  });
});
