import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_LEADER_PROFILE_PORTRAIT,
  LEADER_PROFILE_PORTRAITS,
  getEnabledLeaderProfilePortraits,
  getLeaderProfilePortrait,
  normalizeLeaderProfileCollapsedPools,
  normalizeLeaderProfilePortraitId,
  normalizeLeaderProfilePoolSettings,
} from "./leader-profile-portraits.js";
import { validateLeaderProfilePortraitAssets } from "../scripts/generate-leader-profile-portraits.js";

describe("leader profile portrait metadata", () => {
  it("defaults to the animals pool and filters enabled pools", () => {
    expect(normalizeLeaderProfilePoolSettings(undefined)).toEqual({ tako: false, shmi: false, animals: true });
    const takoPortraits = getEnabledLeaderProfilePortraits({ tako: true, shmi: false, animals: false });
    expect(takoPortraits).toHaveLength(48);
    expect(takoPortraits.every((portrait) => portrait.poolId === "tako")).toBe(true);
    const animalPortraits = getEnabledLeaderProfilePortraits({ tako: false, shmi: false, animals: true });
    expect(animalPortraits).toHaveLength(64);
    expect(animalPortraits.every((portrait) => portrait.poolId === "animals")).toBe(true);
  });

  it("keeps saved pool choices and gives only missing pools the default", () => {
    // Changing the defaults must not undo a saved choice: saved cat pools stay on, and only
    // a pool the settings never mention (here animals, saved before it existed) is defaulted.
    expect(normalizeLeaderProfilePoolSettings({ tako: true, shmi: true })).toEqual({
      tako: true,
      shmi: true,
      animals: true,
    });
    expect(normalizeLeaderProfilePoolSettings({ tako: true, shmi: false, animals: false })).toEqual({
      tako: true,
      shmi: false,
      animals: false,
    });
  });

  it("collapses the cat groups in the picker until the user saves a choice", () => {
    // No saved list means the defaults; any saved list, even an empty one, wins.
    expect(normalizeLeaderProfileCollapsedPools(undefined)).toEqual(["tako", "shmi"]);
    expect(normalizeLeaderProfileCollapsedPools([])).toEqual([]);
    expect(normalizeLeaderProfileCollapsedPools(["animals", "dogs"])).toEqual(["animals"]);
  });

  it("points at checked-in optimized profile assets with compact file sizes", () => {
    const root = process.cwd();
    // Six cat sheets split on a 4x4 grid plus four animal sheets of 16 detected circles each.
    expect(LEADER_PROFILE_PORTRAITS).toHaveLength(160);
    expect(new Set(LEADER_PROFILE_PORTRAITS.map((portrait) => portrait.id)).size).toBe(160);
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
    // Centering and pale-boundary metrics judge crops chosen inside grid cells; the animal
    // portraits are cut along their own painted circles and checked when generated.
    const portraitAssets = validation.filter((asset) => asset.poolId === "tako" || asset.poolId === "shmi");
    const portraitOffsets = portraitAssets.flatMap((asset) => [
      Math.abs(asset.small.visualCenterOffsetX),
      Math.abs(asset.small.visualCenterOffsetY),
      Math.abs(asset.large.visualCenterOffsetX),
      Math.abs(asset.large.visualCenterOffsetY),
    ]);
    // Empty-boundary checks catch the open-scale failure mode where pale source background
    // forms a visible inner arc inside the circular portrait frame.
    const emptyBoundaryRatios = portraitAssets.flatMap((asset) => [
      asset.small.emptyBoundaryRatio,
      asset.small.maxEmptyBoundarySectorRatio,
      asset.large.emptyBoundaryRatio,
      asset.large.maxEmptyBoundarySectorRatio,
    ]);

    expect(Math.max(...portraitOffsets)).toBeLessThanOrEqual(0.24);
    expect(Math.max(...emptyBoundaryRatios)).toBeLessThanOrEqual(0.36);
  });
});
