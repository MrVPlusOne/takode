import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { questStoreFileChunks, replaceFileWithChunks } from "./quest-store-file.js";
import {
  nextQuestNumberFor,
  readQuestDir,
  readQuestDirRaw,
  sortQuestsByRecency,
  writeNewQuestDir,
  forgetQuestDir,
} from "./quest-store-dir.js";

/** Suffix the single-file store gets once its quests live in the quest folder; the file is kept, never deleted. */
export const RETIRED_STORE_SUFFIX = ".before-per-quest-files";
const STAGING_PREFIX = "quests.migrating-";

export interface QuestDirMigrationResult {
  questCount: number;
  /** Verified byte-identical copy of the single-file store, when there was one. */
  backupFile?: string;
  /** Where the single-file store was moved, when there was one. */
  retiredFile?: string;
}

/**
 * Move a single-file quest store (`store.json`, format `mutable_current_record`)
 * into a quest folder without risking its data:
 *
 * 1. copy the file byte for byte into `backupsDir/migrations` and prove the copy;
 * 2. write every quest, exactly as stored, into a staging folder next to `questsDir`;
 * 3. read the staging folder back and require every quest to be identical;
 * 4. rename the staging folder to `questsDir` in one step;
 * 5. rename the store file aside with {@link RETIRED_STORE_SUFFIX}.
 *
 * Any failure before step 4 leaves the store file untouched and `questsDir`
 * absent, so the caller keeps the old store and can retry later.
 */
export async function migrateSingleFileQuestStore(options: {
  storeFile: string;
  questsDir: string;
  backupsDir: string;
  /** Replaces the store's own `legacyBackupDir` (the co-located store records where its legacy files stay). */
  legacyBackupDir?: string;
}): Promise<QuestDirMigrationResult> {
  const bytes = await readFile(options.storeFile);
  const parsed = JSON.parse(bytes.toString("utf-8")) as {
    format?: unknown;
    version?: unknown;
    quests?: unknown;
    nextQuestNumber?: unknown;
    legacyBackupDir?: unknown;
  };
  if (parsed.format !== "mutable_current_record" || parsed.version !== 1 || !Array.isArray(parsed.quests)) {
    throw new Error(`${options.storeFile} is not a quest store this version can migrate`);
  }
  const quests = parsed.quests as { questId: string }[];
  const legacyBackupDir =
    options.legacyBackupDir ??
    (typeof parsed.legacyBackupDir === "string" && parsed.legacyBackupDir.trim() ? parsed.legacyBackupDir : undefined);
  const nextQuestNumber = Math.max(
    typeof parsed.nextQuestNumber === "number" && Number.isInteger(parsed.nextQuestNumber) ? parsed.nextQuestNumber : 1,
    nextQuestNumberFor(quests),
  );

  const backupFile = await writeVerifiedQuestStoreBackup(options.backupsDir, "store-before-per-quest-files", bytes);
  await activateQuestDir(options.questsDir, { nextQuestNumber, quests, legacyBackupDir });
  const retiredFile = await retireStoreFile(options.storeFile);
  return { questCount: quests.length, backupFile, retiredFile };
}

/**
 * Write a complete store into a staging folder, prove it holds exactly these
 * quests, and only then rename it to `questsDir`.
 */
export async function activateQuestDir(
  questsDir: string,
  store: { nextQuestNumber: number; quests: readonly { questId: string }[]; legacyBackupDir?: string },
): Promise<void> {
  if (await exists(questsDir)) throw new Error(`${questsDir} already exists`);
  const ids = new Set<string>();
  for (const quest of store.quests) {
    if (ids.has(quest.questId)) throw new Error(`The store holds ${quest.questId} twice`);
    ids.add(quest.questId);
  }

  const parent = join(questsDir, "..");
  await mkdir(parent, { recursive: true });
  await removeStagingFolders(parent);
  const staging = join(parent, `${STAGING_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`);
  try {
    await writeNewQuestDir(staging, store);
    await verifyQuestDir(staging, store);
    await rename(staging, questsDir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch((cleanupError) =>
      console.error(`[quest-store] Could not remove migration staging folder ${staging}:`, cleanupError),
    );
    throw error;
  }
}

/**
 * Assemble a quest folder back into one `store.json` in the single-file format
 * older builds read, for rolling back to such a build. `outFile` must not exist.
 */
export async function exportQuestDirToSingleFile(questsDir: string, outFile: string): Promise<number> {
  if (await exists(outFile)) throw new Error(`${outFile} already exists; move it aside first`);
  const state = await readQuestDir(questsDir);
  if (!state) throw new Error(`${questsDir} does not exist`);
  // Same field order as the single-file writer, so older builds read it unchanged.
  const store = {
    format: "mutable_current_record",
    version: 1,
    quests: sortQuestsByRecency(state.quests),
    nextQuestNumber: state.nextQuestNumber,
    updatedAt: Date.now(),
    ...(state.legacyBackupDir ? { legacyBackupDir: state.legacyBackupDir } : {}),
  };
  await replaceFileWithChunks(outFile, questStoreFileChunks(store));
  return store.quests.length;
}

/**
 * Roll the store in `liveDir` (`~/.companion/questmaster-live`) back to the
 * single-file format for an older build: export `quests/` to `store.json`,
 * then move `quests/` aside so that build's store is the only one. Run it with
 * the Takode server stopped. Returns where the folder went.
 */
export async function rollBackQuestDirToSingleFile(
  liveDir: string,
): Promise<{ storeFile: string; movedFolder: string }> {
  const questsDir = join(liveDir, "quests");
  const storeFile = join(liveDir, "store.json");
  await exportQuestDirToSingleFile(questsDir, storeFile);
  const movedFolder = join(liveDir, `quests.rolled-back-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await rename(questsDir, movedFolder);
  return { storeFile, movedFolder };
}

/** Save `bytes` under `backupsDir/migrations` and prove the saved file holds exactly them. */
export async function writeVerifiedQuestStoreBackup(
  backupsDir: string,
  prefix: string,
  bytes: Buffer | string,
): Promise<string> {
  const dir = join(backupsDir, "migrations");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(path, bytes, { flag: "wx" });
  const saved = await readFile(path);
  if (sha256(saved) !== sha256(typeof bytes === "string" ? Buffer.from(bytes) : bytes)) {
    throw new Error(`Backup ${path} does not match the quest store`);
  }
  JSON.parse(saved.toString("utf-8"));
  return path;
}

async function verifyQuestDir(
  dir: string,
  store: { nextQuestNumber: number; quests: readonly { questId: string }[]; legacyBackupDir?: string },
): Promise<void> {
  const raw = await readQuestDirRaw(dir);
  const expectedFiles = store.quests.map((quest) => `${quest.questId}.json`).sort();
  if (JSON.stringify(raw.files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Migration check failed: ${dir} holds ${raw.files.length} files for ${store.quests.length} quests`);
  }
  for (const quest of store.quests) {
    if (JSON.stringify(raw.quests.get(quest.questId)) !== JSON.stringify(quest)) {
      throw new Error(`Migration check failed: ${quest.questId} differs after writing it`);
    }
  }
  if (raw.meta.nextQuestNumber !== store.nextQuestNumber || raw.meta.legacyBackupDir !== store.legacyBackupDir) {
    throw new Error("Migration check failed: the store's next quest number or legacy folder differs");
  }
  // The loader the server uses must read every one of them too.
  const loaded = await readQuestDir(dir);
  forgetQuestDir(dir);
  if (loaded?.quests.length !== store.quests.length) {
    throw new Error(`Migration check failed: the quest loader read ${loaded?.quests.length ?? 0} quests`);
  }
}

async function retireStoreFile(storeFile: string): Promise<string> {
  let target = `${storeFile}${RETIRED_STORE_SUFFIX}`;
  if (await exists(target)) target = `${target}-${Date.now()}`;
  await rename(storeFile, target);
  return target;
}

/** Staging folders left by an interrupted migration are only ever our own copies. */
async function removeStagingFolders(parent: string): Promise<void> {
  for (const name of await readdir(parent)) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    console.warn(`[quest-store] Removing ${join(parent, name)}, left by an interrupted migration`);
    await rm(join(parent, name), { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
