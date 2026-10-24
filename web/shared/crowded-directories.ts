/**
 * Directories with so many entries that Bun programs below them start slowly.
 *
 * When Bun starts, it reads the full listing of its working directory, every
 * directory above it, and the directories of the code it loads and their
 * parents (bun-command-launch.ts explains why). Takode keeps the caller's
 * directory out of that for its own commands, but a crowded folder above the
 * Takode checkout still slows every Takode command, and one above the temp or
 * worktree folders slows Bun programs that sessions run there. A `takode node`
 * looks for such folders when it starts and reports them, so Settings can say
 * where they are instead of sessions slowing down without explanation.
 */

/** Entries from which a folder counts as crowded: about 30 ms per Bun start on an idle machine, several times that when busy or on a network disk. */
export const CROWDED_DIRECTORY_ENTRIES = 50_000;

/** Counting stops here, so a check of a huge folder stays short. */
export const CROWDED_DIRECTORY_COUNT_LIMIT = 200_000;

/** What a crowded folder slows: Takode's own commands, or Bun programs run in temporary folders or session worktrees. */
export type CrowdedDirectoryEffect = "takode" | "temp" | "worktrees";

export interface CrowdedDirectory {
  path: string;
  /** Entries counted, up to {@link CROWDED_DIRECTORY_COUNT_LIMIT}. */
  entries: number;
  /** Counting stopped at the limit; the folder holds more. */
  more: boolean;
  affects: CrowdedDirectoryEffect[];
}

const EFFECT_TEXT: Record<CrowdedDirectoryEffect, { slows: string; fix: string }> = {
  takode: {
    slows: "every takode, quest and memory command (the Takode checkout is below it)",
    fix: "remove what it no longer needs or move the Takode checkout elsewhere",
  },
  temp: {
    slows: "Bun programs started in temporary folders, such as test runs",
    fix: "delete old files from it",
  },
  worktrees: {
    slows: "Bun programs that sessions run in their worktrees",
    fix: "remove old worktrees or choose another worktree folder in this machine's settings",
  },
};

/** One sentence for a person: where the folder is, what it slows and how to fix it. */
export function crowdedDirectoryWarning(directory: CrowdedDirectory): string {
  const count = `${directory.more ? "over " : ""}${directory.entries.toLocaleString("en-US")}`;
  const slows = directory.affects.map((effect) => EFFECT_TEXT[effect].slows).join(" and ");
  const fixes = directory.affects.map((effect) => EFFECT_TEXT[effect].fix);
  return `${directory.path} holds ${count} entries, which Bun reads each time it starts, slowing ${slows}. To fix it, ${fixes.join(", or ")}.`;
}
