import { opendir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CROWDED_DIRECTORY_COUNT_LIMIT,
  CROWDED_DIRECTORY_ENTRIES,
  type CrowdedDirectory,
  type CrowdedDirectoryEffect,
} from "../../shared/crowded-directories.js";

export interface CrowdedDirectoryRoots {
  /** The Takode web folder this machine runs its commands from. */
  takodeRoot: string;
  /** The temporary folder (`os.tmpdir()`). */
  tempDir: string;
  /** The folder holding session worktrees, one subfolder per repository. */
  worktreesDir: string;
}

/**
 * Finds the folders whose size slows Bun starts on this machine (see
 * shared/crowded-directories.ts): the folders above the Takode checkout, the
 * temporary folder and the folders above it, and the worktree folder, its
 * repository folders and the folders above it. Folders it cannot read are skipped.
 */
export async function findCrowdedDirectories(
  roots: CrowdedDirectoryRoots,
  threshold = CROWDED_DIRECTORY_ENTRIES,
  limit = CROWDED_DIRECTORY_COUNT_LIMIT,
): Promise<CrowdedDirectory[]> {
  const candidates = new Map<string, CrowdedDirectoryEffect[]>();
  const add = (path: string, effect: CrowdedDirectoryEffect) => {
    const effects = candidates.get(path) ?? [];
    if (!effects.includes(effect)) effects.push(effect);
    candidates.set(path, effects);
  };
  for (const path of selfAndParents(roots.takodeRoot)) add(path, "takode");
  for (const path of selfAndParents(roots.tempDir)) add(path, "temp");
  for (const path of selfAndParents(roots.worktreesDir)) add(path, "worktrees");
  for (const repo of await readdir(roots.worktreesDir, { withFileTypes: true }).catch(() => [])) {
    if (repo.isDirectory()) add(join(roots.worktreesDir, repo.name), "worktrees");
  }

  const crowded: CrowdedDirectory[] = [];
  for (const [path, affects] of candidates) {
    const entries = await countEntries(path, limit);
    if (entries >= threshold) crowded.push({ path, entries, more: entries >= limit, affects });
  }
  return crowded;
}

function selfAndParents(path: string): string[] {
  const paths = [path];
  for (let parent = dirname(path); parent !== paths.at(-1); parent = dirname(parent)) paths.push(parent);
  return paths;
}

/** Entries in `path`, counting no further than `limit`; 0 when it cannot be read. */
async function countEntries(path: string, limit: number): Promise<number> {
  let entries = 0;
  try {
    // Leaving the loop early closes the directory.
    for await (const _entry of await opendir(path, { bufferSize: 1024 })) {
      if (++entries >= limit) break;
    }
  } catch (error) {
    // A folder this user may not read, or one removed meanwhile, cannot be the cause; report anything else.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM" && code !== "ENOENT")
      console.warn(`[crowded-directories] Could not count the entries of ${path}:`, error);
  }
  return entries;
}
