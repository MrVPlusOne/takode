/**
 * Where the living Ink & Paper's sea of clouds enters: banks along the right edge, at valley
 * heights above the lake, in amounts that swell and thin but never stop, so the valleys always
 * hold some cloud without the sky filling up.
 */
import { describe, expect, it } from "vitest";
import { CloudBanks } from "./ink-alive-sources.js";

describe("CloudBanks", () => {
  it("brings cloud in at the right edge, at valley heights above the lake", () => {
    const banks = new CloudBanks(9);
    const horizon = 0.8;
    for (let t = 0; t < 300; t += 0.5) {
      for (const splat of banks.release(t, 0.05, horizon)) {
        expect(splat.x).toBeGreaterThan(1);
        expect(splat.y).toBeLessThan(horizon);
        expect(splat.y).toBeGreaterThan(horizon - 0.4);
      }
    }
  });

  it("swells and thins slowly but never stops, in a modest amount over time", () => {
    const banks = new CloudBanks(5);
    let total = 0;
    let least = Number.POSITIVE_INFINITY;
    let most = 0;
    for (let t = 0; t < 600; t += 0.05) {
      const amount = banks.release(t, 0.05, 0.8).reduce((sum, splat) => sum + splat.amount, 0);
      total += amount;
      least = Math.min(least, amount);
      most = Math.max(most, amount);
    }
    expect(least).toBeGreaterThan(0);
    // Banks visibly wax and wane rather than pouring in as a steady sheet.
    expect(most / least).toBeGreaterThan(1.8);
    expect(total / 600).toBeGreaterThan(0.05);
    expect(total / 600).toBeLessThan(1);
  });

  it("adds nothing when no scene time passed", () => {
    expect(new CloudBanks(1).release(10, 0, 0.8)).toHaveLength(0);
  });
});
