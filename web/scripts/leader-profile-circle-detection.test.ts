import { describe, expect, it } from "vitest";
import { detectPortraitCircles } from "./leader-profile-circle-detection.js";

const BACKGROUND: [number, number, number] = [251, 249, 244];

/** Builds an RGB sheet on the off-white background used by the avatar source sheets. */
function createSheet(width: number, height: number) {
  const raw = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) raw.set(BACKGROUND, index * 3);
  const paint = (inside: (x: number, y: number) => boolean, color: [number, number, number]) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (inside(x + 0.5, y + 0.5)) raw.set(color, (y * width + x) * 3);
      }
    }
  };
  return { raw, paint };
}

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) <= r;

describe("detectPortraitCircles", () => {
  it("finds portraits by their painted circles, not a fixed grid, and returns them in reading order", () => {
    // Uneven placement: the second row is offset and the circles differ in size, so a grid
    // split would cut them wrongly. Painting order is scrambled to check the sort.
    const { raw, paint } = createSheet(400, 300);
    paint(disc(290, 205, 60), [40, 90, 160]);
    paint(disc(80, 75, 55), [200, 120, 60]);
    paint(disc(110, 215, 50), [90, 160, 80]);
    paint(disc(270, 70, 58), [150, 60, 120]);

    const circles = detectPortraitCircles(raw, 400, 300, 3);

    const centers = circles.map((circle) => [Math.round(circle.centerX), Math.round(circle.centerY)]);
    expect(centers).toEqual([
      [80, 75],
      [270, 70],
      [110, 215],
      [290, 205],
    ]);
    // The usable radius sits a couple of pixels inside the painted edge.
    expect(circles.map((circle) => Math.round(circle.radius))).toEqual([53, 56, 48, 58]);
    for (const circle of circles) expect(circle.rimBackgroundRatio).toBe(0);
  });

  it("ignores a pale halo around a portrait", () => {
    // Hand-drawn sheets surround some portraits with a slightly whiter glow; it must not
    // count as portrait, or the avatar would show an off-white ring.
    const { raw, paint } = createSheet(200, 200);
    paint(disc(100, 100, 80), [254, 253, 250]);
    paint(disc(100, 100, 70), [60, 110, 70]);

    const [circle] = detectPortraitCircles(raw, 200, 200, 3);

    expect(circle.radius).toBeLessThanOrEqual(68);
    expect(circle.rimBackgroundRatio).toBe(0);
  });

  it("keeps the full circle when pale content touches the rim", () => {
    // Snow or white fur at the edge reads as background and cuts a notch into the painted
    // region; the circle must stay centered on the portrait instead of shrinking away from it.
    // Without closing the notch the largest inscribed circle would be about radius 60 and
    // shifted roughly 10px away from it.
    const { raw, paint } = createSheet(200, 200);
    paint(disc(100, 100, 70), [70, 100, 150]);
    const inWedge = (x: number, y: number) => {
      const angle = (Math.atan2(y - 100, x - 100) * 180) / Math.PI;
      return angle > 100 && angle < 120 && Math.hypot(x - 100, y - 100) > 50;
    };
    paint((x, y) => disc(100, 100, 71)(x, y) && inWedge(x, y), [249, 249, 247]);

    const [circle] = detectPortraitCircles(raw, 200, 200, 3);

    expect(Math.abs(circle.centerX - 100)).toBeLessThan(2);
    expect(Math.abs(circle.centerY - 100)).toBeLessThan(2);
    expect(circle.radius).toBeGreaterThanOrEqual(64);
  });
});
