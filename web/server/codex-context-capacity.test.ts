import { describe, expect, it } from "vitest";
import {
  leaderRecycleThresholdForUsableCapacity,
  rawContextWindowForUsableCapacity,
  sourceRawContextWindowForLeaderUsableCapacity,
} from "./codex-context-capacity.js";

describe("Codex context capacity derivation", () => {
  it("derives raw provider values from desired usable capacity", () => {
    expect(rawContextWindowForUsableCapacity(240_000, 95)).toBe(252_632);
    expect(sourceRawContextWindowForLeaderUsableCapacity(660_000, 95)).toBe(721_053);
    expect(leaderRecycleThresholdForUsableCapacity(660_000)).toMatchObject({
      recycleThresholdTokens: 660_000,
      sourceEffectiveContextWindowTokens: 685_000,
      usedFallback: false,
    });
  });
});
