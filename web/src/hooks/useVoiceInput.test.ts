import { describe, expect, it } from "vitest";
import { normalizeMeterLevel } from "./useVoiceInput.js";

describe("normalizeMeterLevel", () => {
  it("keeps silence at zero", () => {
    expect(normalizeMeterLevel(0, 0)).toBe(0);
  });

  it("filters low-level background noise near the floor", () => {
    expect(normalizeMeterLevel(0.009, 0)).toBe(0);
  });

  it("boosts speech-like RMS values for a responsive meter", () => {
    const level = normalizeMeterLevel(0.05, 0);
    expect(level).toBeGreaterThan(0.1);
    expect(level).toBeLessThan(0.35);
  });

  it("uses slower release smoothing so bars do not snap to zero", () => {
    const rising = normalizeMeterLevel(0.12, 0);
    const falling = normalizeMeterLevel(0, rising);
    expect(rising).toBeGreaterThan(0.25);
    expect(falling).toBeGreaterThan(0.2);
    expect(falling).toBeLessThan(rising);
  });
});
