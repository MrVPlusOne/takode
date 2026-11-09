import { describe, expect, it } from "vitest";
import { isScenicBackground, normalizeScenicBackground } from "./scenic-background.js";

describe("scenic background values", () => {
  it("accepts Off and the three painted styles", () => {
    for (const value of ["off", "meadow", "seaside", "ink"]) expect(isScenicBackground(value)).toBe(true);
  });

  it("reads anything missing or unknown, such as a retired style, as Off", () => {
    expect(normalizeScenicBackground(undefined)).toBe("off");
    expect(normalizeScenicBackground("sakura")).toBe("off");
    expect(normalizeScenicBackground(3)).toBe("off");
    expect(normalizeScenicBackground("ink")).toBe("ink");
  });
});
