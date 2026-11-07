/**
 * Rolls the quest store back to the single-file format, for running a Takode
 * build older than November 2026. Stop the Takode server first. It writes
 * `~/.companion/questmaster-live/store.json` from the quest files and moves
 * `~/.companion/questmaster-live/quests` aside (nothing is deleted). Starting a
 * current build later moves `store.json` into one file per quest again.
 *
 *   bun web/scripts/quest-store-roll-back.ts
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { rollBackQuestDirToSingleFile } from "../server/quest-store-migration.js";

if (import.meta.main) {
  const liveDir = join(homedir(), ".companion", "questmaster-live");
  const { storeFile, movedFolder } = await rollBackQuestDirToSingleFile(liveDir);
  console.log(`Wrote ${storeFile}; the quest folder is now ${movedFolder}.`);
}
