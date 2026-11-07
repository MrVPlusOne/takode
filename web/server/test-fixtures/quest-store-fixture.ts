import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The quest folder under a test's `~/.companion`. */
export function questStoreDir(companionDir: string): string {
  return join(companionDir, "questmaster-live", "quests");
}

/**
 * Replace the quest store under a test's `~/.companion` with exactly these
 * quest records, in the layout the store writes: one `q-N.json` per quest plus
 * `_meta.json`. Records are written as given, so tests can seed partial or
 * legacy-shaped quests and check how the store normalizes them.
 */
export function writeQuestStoreFixture(
  companionDir: string,
  store: { quests: Record<string, unknown>[]; nextQuestNumber?: number; legacyBackupDir?: string },
): void {
  const dir = questStoreDir(companionDir);
  rmSync(dir, { recursive: true, force: true }); // sync-ok: test fixture
  mkdirSync(dir, { recursive: true });
  let highest = 0;
  for (const quest of store.quests) {
    const questId = String(quest.questId);
    highest = Math.max(highest, Number(questId.replace("q-", "")) || 0);
    writeFileSync(join(dir, `${questId}.json`), `${JSON.stringify(quest, null, 2)}\n`); // sync-ok: test fixture
  }
  const meta = {
    format: "quest_per_file",
    version: 2,
    nextQuestNumber: store.nextQuestNumber ?? highest + 1,
    ...(store.legacyBackupDir ? { legacyBackupDir: store.legacyBackupDir } : {}),
  };
  writeFileSync(join(dir, "_meta.json"), `${JSON.stringify(meta, null, 2)}\n`); // sync-ok: test fixture
}

/** One quest record exactly as stored, or undefined when its file does not exist. */
export function readQuestFixture(companionDir: string, questId: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(questStoreDir(companionDir), `${questId}.json`), "utf-8")); // sync-ok: test fixture
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Every quest record as stored, by quest ID. */
export function readQuestStoreFixture(companionDir: string): Map<string, Record<string, unknown>> {
  const quests = new Map<string, Record<string, unknown>>();
  const names = readdirSync(questStoreDir(companionDir)); // sync-ok: test fixture
  for (const name of names) {
    const match = /^(q-\d+)\.json$/.exec(name);
    if (match) quests.set(match[1]!, readQuestFixture(companionDir, match[1]!)!);
  }
  return quests;
}

/** Add one quest record to the store under a test's `~/.companion`, creating the store if needed. */
export function seedQuestFixture(companionDir: string, quest: Record<string, unknown>): void {
  const dir = questStoreDir(companionDir);
  mkdirSync(dir, { recursive: true });
  const questId = String(quest.questId);
  writeFileSync(join(dir, `${questId}.json`), `${JSON.stringify(quest, null, 2)}\n`); // sync-ok: test fixture
  let nextQuestNumber = 1;
  try {
    nextQuestNumber = JSON.parse(readFileSync(join(dir, "_meta.json"), "utf-8")).nextQuestNumber; // sync-ok: test fixture
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  nextQuestNumber = Math.max(nextQuestNumber, (Number(questId.replace("q-", "")) || 0) + 1);
  const meta = { format: "quest_per_file", version: 2, nextQuestNumber };
  writeFileSync(join(dir, "_meta.json"), `${JSON.stringify(meta, null, 2)}\n`); // sync-ok: test fixture
}
