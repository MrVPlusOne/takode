import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _getCodexSpawnPrepCacheStatsForTest,
  _migrateLegacyCodexSkillsToAgentsHomeForTest,
  _resetCodexSpawnPrepCachesForTest,
  _resolveHostCodexLaunchBinaryForTest,
} from "./cli-launcher-codex.js";

const codexBootstrapCacheMarker = 'CACHE_DIR = os.path.expanduser("~/.cache/codex")';

describe("Codex spawn prep caching", () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    _resetCodexSpawnPrepCachesForTest();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    _resetCodexSpawnPrepCachesForTest();
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeTempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "takode-codex-spawn-prep-"));
    tempRoots.push(root);
    return root;
  }

  it("reuses host launch binary resolution instead of rescanning DotSlash caches for replacement bursts", async () => {
    const root = await makeTempRoot();
    const binary = join(root, "bin", "codex");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(binary, `#!/usr/bin/env python3\n${codexBootstrapCacheMarker}\n`, "utf-8");

    const dotslashRoot = join(root, "dotslash-cache");
    const artifact = join(dotslashRoot, "prefix", "hash", "codex");
    await mkdir(join(dotslashRoot, "prefix", "hash"), { recursive: true });
    await writeFile(artifact, "native codex artifact\n", "utf-8");
    vi.stubEnv("DOTSLASH_CACHE", dotslashRoot);

    const first = await _resolveHostCodexLaunchBinaryForTest("session-a", binary, join(root, "codex-home"));
    const second = await _resolveHostCodexLaunchBinaryForTest("session-b", binary, join(root, "codex-home"));

    // Worker replacement can launch several Codex sessions in a short burst. The
    // first call proves the cache artifact path; the second proves the expensive
    // legacy DotSlash tree scan is not repeated on the hot path.
    expect(first.binary).toBe(artifact);
    expect(second.binary).toBe(artifact);
    expect(_getCodexSpawnPrepCacheStatsForTest()).toMatchObject({
      hostLaunchBinaryCacheMisses: 1,
      hostLaunchBinaryCacheHits: 1,
      latestCachedCodexArtifactScans: 1,
    });
  });

  it("reuses legacy skill migration checks during repeated Codex home prep", async () => {
    const root = await makeTempRoot();
    const sourceHome = join(root, "source-home");
    const legacyHome = join(root, "legacy-home");
    const destSkillsHome = join(root, "agents-skills");
    await mkdir(join(sourceHome, "skills", "example-skill"), { recursive: true });
    await mkdir(join(legacyHome, "skills"), { recursive: true });
    await writeFile(join(sourceHome, "skills", "example-skill", "SKILL.md"), "name: example\n", "utf-8");

    await _migrateLegacyCodexSkillsToAgentsHomeForTest(sourceHome, { destSkillsHome, legacyCodexHome: legacyHome });
    await _migrateLegacyCodexSkillsToAgentsHomeForTest(sourceHome, { destSkillsHome, legacyCodexHome: legacyHome });
    await _migrateLegacyCodexSkillsToAgentsHomeForTest(sourceHome, { destSkillsHome, legacyCodexHome: legacyHome });

    // The first migration copies compatibility skill content; the second
    // observes the changed destination, and the third represents the next
    // session spawn with unchanged source and destination skill roots.
    await expect(readFile(join(destSkillsHome, "example-skill", "SKILL.md"), "utf-8")).resolves.toBe("name: example\n");
    expect(_getCodexSpawnPrepCacheStatsForTest()).toMatchObject({
      legacySkillMigrationCacheMisses: 2,
      legacySkillMigrationCacheHits: 1,
    });
  });
});
