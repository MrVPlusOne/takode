import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_LEADER_PROFILE_PORTRAIT,
  LEADER_PROFILE_PORTRAITS,
  getEnabledLeaderProfilePortraits,
  getLeaderProfilePortrait,
  leaderProfilePortraitInkUrl,
  normalizeLeaderProfileCollapsedPools,
  normalizeLeaderProfilePortraitId,
  normalizeLeaderProfilePoolSettings,
} from "./leader-profile-portraits.js";
import { RETIRED_LEADER_PROFILE_PORTRAIT_REPLACEMENTS } from "./leader-profile-portrait-retirements.js";
import { validateLeaderProfilePortraitAssets } from "../scripts/generate-leader-profile-portraits.js";

describe("leader profile portrait metadata", () => {
  it("defaults to the animals pool and filters enabled pools", () => {
    expect(normalizeLeaderProfilePoolSettings(undefined)).toEqual({ tako: false, shmi: false, animals: true });
    const takoPortraits = getEnabledLeaderProfilePortraits({ tako: true, shmi: false, animals: false });
    expect(takoPortraits).toHaveLength(16);
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
    // 16 cats kept from each cat set's three 4x4 sheets, plus four animal sheets of 16 circles each.
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
    expect(normalizeLeaderProfilePortraitId("shmi3")).toBe("shmi2-11");
    expect(getLeaderProfilePortrait("shmi3")).toMatchObject({ id: "shmi2-11", poolId: "shmi" });
  });

  it("replaces every retired portrait with a portrait of the same set that still exists", () => {
    // Leaders keep saved ids of cats dropped from the sets, so each must resolve to a kept cat
    // of its own set, never to nothing or to another retired id.
    const retired = Object.entries(RETIRED_LEADER_PROFILE_PORTRAIT_REPLACEMENTS);
    expect(retired.filter(([id]) => id.includes("-"))).toHaveLength(64);
    for (const [id, replacement] of retired) {
      expect(
        LEADER_PROFILE_PORTRAITS.some((portrait) => portrait.id === id),
        `${id} is still offered`,
      ).toBe(false);
      const portrait = getLeaderProfilePortrait(id);
      expect(portrait?.id, `${id} should resolve`).toBe(replacement);
      expect(portrait?.poolId).toBe(id.replace(/\d.*$/, ""));
    }
  });

  it("has an ink painting at both sizes for every pooled portrait, and none for the fallback", () => {
    // Ink & Paper swaps these in for every portrait, so a missing file would show a broken image.
    const root = process.cwd();
    for (const portrait of LEADER_PROFILE_PORTRAITS) {
      for (const variant of ["small", "large"] as const) {
        const url = leaderProfilePortraitInkUrl(portrait, variant)!;
        expect(url).toMatch(new RegExp(`/ink/${portrait.id}\\.v\\d+\\.${variant === "small" ? 96 : 320}\\.webp$`));
        const path = join(root, "public", url.replace(/^\//, ""));
        expect(existsSync(path), `${url} should exist`).toBe(true);
        expect(statSync(path).size, `${url} should be small enough for repeated UI use`).toBeLessThan(40_000);
      }
    }
    expect(leaderProfilePortraitInkUrl(FALLBACK_LEADER_PROFILE_PORTRAIT, "small")).toBeNull();
    // No leftover ink files for retired portraits.
    expect(readdirSync(join(root, "public", "leader-profile-portraits", "ink"))).toHaveLength(
      LEADER_PROFILE_PORTRAITS.length * 2,
    );
  });

  // Decodes and measures every checked-in portrait (over 300 images): about 3 s of CPU alone,
  // several times that while a full suite or several run at once, so it gets a longer budget.
  it("keeps generated round assets mechanically centered", { timeout: 30_000 }, async () => {
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
