import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_LEADER_PROFILE_PORTRAIT,
  LEADER_PROFILE_PORTRAITS,
  getEnabledLeaderProfilePortraits,
  getLeaderProfilePortrait,
  normalizeLeaderProfilePortraitId,
  normalizeLeaderProfilePoolSettings,
} from "./leader-profile-portraits.js";
import { validateLeaderProfilePortraitAssets } from "../scripts/generate-leader-profile-portraits.js";

describe("leader profile portrait metadata", () => {
  it("defaults both built-in pools on and filters enabled pools", () => {
    expect(normalizeLeaderProfilePoolSettings(undefined)).toEqual({ tako: true, shmi: true });
    const takoPortraits = getEnabledLeaderProfilePortraits({ tako: true, shmi: false });
    expect(takoPortraits).toHaveLength(48);
    expect(takoPortraits.every((portrait) => portrait.poolId === "tako")).toBe(true);
  });

  it("points at checked-in optimized profile assets with compact file sizes", () => {
    const root = process.cwd();
    // Six prepared source sheets are split into a 4x4 grid, yielding 96 individual portraits.
    expect(LEADER_PROFILE_PORTRAITS).toHaveLength(96);
    expect(new Set(LEADER_PROFILE_PORTRAITS.map((portrait) => portrait.id)).size).toBe(96);
    for (const portrait of [...LEADER_PROFILE_PORTRAITS, FALLBACK_LEADER_PROFILE_PORTRAIT]) {
      for (const url of [portrait.smallUrl, portrait.largeUrl]) {
        const path = join(root, "public", url.replace(/^\//, ""));
        expect(existsSync(path), `${url} should exist`).toBe(true);
        expect(statSync(path).size, `${url} should be small enough for repeated UI use`).toBeLessThan(40_000);
      }
    }
  });

  it("maps obsolete sheet-level ids to individual generated portraits", () => {
    expect(normalizeLeaderProfilePortraitId("shmi3")).toBe("shmi3-01");
    expect(getLeaderProfilePortrait("shmi3")).toMatchObject({ id: "shmi3-01", poolId: "shmi" });
  });

  it("keeps generated round assets mechanically centered", async () => {
    const validation = await validateLeaderProfilePortraitAssets(
      LEADER_PROFILE_PORTRAITS,
      FALLBACK_LEADER_PROFILE_PORTRAIT,
    );
    const portraitOffsets = validation
      .filter((asset) => asset.poolId !== "fallback")
      .flatMap((asset) => [
        Math.abs(asset.small.visualCenterOffsetX),
        Math.abs(asset.small.visualCenterOffsetY),
        Math.abs(asset.large.visualCenterOffsetX),
        Math.abs(asset.large.visualCenterOffsetY),
      ]);

    expect(Math.max(...portraitOffsets)).toBeLessThanOrEqual(0.24);
  });
});
