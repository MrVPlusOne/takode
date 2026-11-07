import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { deepFreeze } from "./cached-json-file.js";
import { normalizeLiveQuest } from "./quest-store-normalize.js";
import type { QuestmasterTask } from "./quest-types.js";

/**
 * The quest store keeps one file per quest, `q-N.json`, in one folder, plus
 * `_meta.json` for what belongs to the whole store. Every write replaces just
 * the files it changes through a temporary file and a rename, so a quest change
 * costs the size of that quest instead of the whole store.
 *
 * `_meta.json` is rewritten last by every write. Its identity (inode, size and
 * mtime) therefore changes with every write by any process, so one `stat`
 * tells a reader whether anything changed since it last looked; only then does
 * it compare each file's own identity and re-read the files that changed.
 */

export const QUEST_DIR_FORMAT = "quest_per_file";
const QUEST_DIR_VERSION = 2;
const META_FILE = "_meta.json";
const QUEST_FILE_RE = /^(q-\d+)\.json$/;
const TEMP_FILE_RE = /^\..+\.tmp$/;
/** A temp file this old belongs to a writer that died; younger ones may still be renamed into place. */
const STALE_TEMP_MS = 10 * 60_000;
/** Files read or written at once; well under the open-file limit. */
const READ_BATCH = 32;

/** The whole quest store as the server holds it in memory. */
export interface QuestDirState {
  nextQuestNumber: number;
  /** Quests sorted by recency, newest first. */
  quests: QuestmasterTask[];
  /** Where the pre-July per-version quest files were preserved, for the read-only history view. */
  legacyBackupDir?: string;
}

interface QuestDirMeta {
  format: typeof QUEST_DIR_FORMAT;
  version: typeof QUEST_DIR_VERSION;
  nextQuestNumber: number;
  legacyBackupDir?: string;
}

interface CachedDir {
  metaStamp: string;
  fileStamps: Map<string, string>;
  questsByFile: Map<string, QuestmasterTask>;
  state: QuestDirState;
}

const cache = new Map<string, CachedDir>();
const loading = new Map<string, Promise<QuestDirState | null>>();
const fileBytes = new WeakMap<object, Buffer>();

/**
 * The store in `dir`, or null when the folder does not exist. The result is
 * deep-frozen and shared: callers must never edit it in place.
 */
export async function readQuestDir(dir: string): Promise<QuestDirState | null> {
  const metaStamp = await fileStamp(join(dir, META_FILE));
  const cached = cache.get(dir);
  if (metaStamp !== null && cached?.metaStamp === metaStamp) return cached.state;
  if (metaStamp === null && !(await exists(dir))) {
    cache.delete(dir);
    return null;
  }
  let pending = loading.get(dir);
  if (!pending) {
    pending = rescan(dir).finally(() => loading.delete(dir));
    loading.set(dir, pending);
  }
  return pending;
}

/**
 * Persist the difference between two states of the store in `dir`: quests in
 * `after` that are not the very objects `before` held are written, quests
 * missing from `after` are deleted. The caller holds the store's write lock and
 * `before` is the state it read under that lock. Returns the new frozen state,
 * exactly what a fresh read of the folder would return.
 */
export async function writeQuestDirChanges(
  dir: string,
  before: QuestDirState,
  after: QuestDirState,
): Promise<QuestDirState> {
  const kept = new Set(before.quests);
  const changed = after.quests
    .filter((quest) => !kept.has(quest))
    .map((quest) => deepFreeze(JSON.parse(JSON.stringify(normalizeLiveQuest(quest))) as QuestmasterTask));
  const afterIds = new Set(after.quests.map((quest) => quest.questId));
  const removed = before.quests.filter((quest) => !afterIds.has(quest.questId)).map((quest) => quest.questId);
  const meta: QuestDirMeta = {
    format: QUEST_DIR_FORMAT,
    version: QUEST_DIR_VERSION,
    // Never lower: a deleted quest's number must not be handed out again.
    nextQuestNumber: Math.max(
      before.nextQuestNumber,
      after.nextQuestNumber,
      nextQuestNumberFor(before.quests),
      nextQuestNumberFor(after.quests),
    ),
    ...(after.legacyBackupDir ? { legacyBackupDir: after.legacyBackupDir } : {}),
  };

  // Deleting can lower the highest number on disk, so the meta file must hold
  // the next number before the file goes; it is written again last as the change signal.
  if (removed.length > 0) await writeMeta(dir, meta);
  for (const quest of changed) await replaceFile(join(dir, questFileName(quest.questId)), questFileBytes(quest));
  for (const questId of removed) await unlinkIfPresent(join(dir, questFileName(questId)));
  await writeMeta(dir, meta);

  const previous = cache.get(dir);
  const questsByFile = new Map(previous?.questsByFile);
  const fileStamps = new Map(previous?.fileStamps);
  for (const questId of removed) {
    questsByFile.delete(questFileName(questId));
    fileStamps.delete(questFileName(questId));
  }
  for (const quest of changed) {
    const name = questFileName(quest.questId);
    questsByFile.set(name, quest);
    const stamp = await fileStamp(join(dir, name));
    if (stamp) fileStamps.set(name, stamp);
  }
  const state = deepFreeze({
    nextQuestNumber: meta.nextQuestNumber,
    quests: sortQuestsByRecency([...after.quests.filter((quest) => kept.has(quest)), ...changed]),
    ...(meta.legacyBackupDir ? { legacyBackupDir: meta.legacyBackupDir } : {}),
  });
  const metaStamp = await fileStamp(join(dir, META_FILE));
  if (metaStamp && previous) cache.set(dir, { metaStamp, fileStamps, questsByFile, state });
  else cache.delete(dir);
  return state;
}

/**
 * Write a complete store into `dir`, which must not exist yet. Quests are
 * written exactly as given, without normalizing, so a migration can prove the
 * files hold the very records it read.
 */
export async function writeNewQuestDir(
  dir: string,
  store: { nextQuestNumber: number; quests: readonly object[]; legacyBackupDir?: string },
): Promise<void> {
  const questIds = store.quests.map((quest) => {
    const questId = (quest as { questId?: unknown }).questId;
    if (typeof questId !== "string" || !QUEST_FILE_RE.test(questFileName(questId))) {
      throw new Error(`Quest record has an invalid questId: ${String(questId)}`);
    }
    return questId;
  });
  await mkdir(dir);
  for (let start = 0; start < store.quests.length; start += READ_BATCH) {
    await Promise.all(
      store.quests
        .slice(start, start + READ_BATCH)
        .map((quest, index) => replaceFile(join(dir, questFileName(questIds[start + index]!)), questFileBytes(quest))),
    );
  }
  await writeMeta(dir, {
    format: QUEST_DIR_FORMAT,
    version: QUEST_DIR_VERSION,
    nextQuestNumber: store.nextQuestNumber,
    ...(store.legacyBackupDir ? { legacyBackupDir: store.legacyBackupDir } : {}),
  });
}

/** The quest records and meta in `dir` exactly as stored, unnormalized, for verification. */
export async function readQuestDirRaw(
  dir: string,
): Promise<{ meta: Record<string, unknown>; quests: Map<string, unknown>; files: string[] }> {
  const meta = JSON.parse(await readFile(join(dir, META_FILE), "utf-8")) as Record<string, unknown>;
  const files = (await readdir(dir)).filter((name) => name !== META_FILE).sort();
  const quests = new Map<string, unknown>();
  const questFiles = files.filter((name) => QUEST_FILE_RE.test(name));
  for (let start = 0; start < questFiles.length; start += READ_BATCH) {
    const batch = questFiles.slice(start, start + READ_BATCH);
    const texts = await Promise.all(batch.map((name) => readFile(join(dir, name), "utf-8")));
    batch.forEach((name, index) => quests.set(QUEST_FILE_RE.exec(name)![1]!, JSON.parse(texts[index]!)));
  }
  return { meta, quests, files };
}

/** Newest first by the latest of creation, update and status change; equal times by quest number, highest first. */
export function sortQuestsByRecency<T extends QuestmasterTask>(quests: readonly T[]): T[] {
  return [...quests].sort(
    (a, b) => questRecency(b) - questRecency(a) || questNumber(b.questId) - questNumber(a.questId),
  );
}

/** One more than the highest quest number in `quests`. */
export function nextQuestNumberFor(quests: readonly { questId: string }[]): number {
  return quests.reduce((highest, quest) => Math.max(highest, questNumber(quest.questId)), 0) + 1;
}

/** The bytes of a quest's file. Cached on frozen quests, which cannot change after. */
export function questFileBytes(quest: object): Buffer {
  const cached = fileBytes.get(quest);
  if (cached) return cached;
  const bytes = Buffer.from(`${JSON.stringify(quest, null, 2)}\n`);
  if (Object.isFrozen(quest)) fileBytes.set(quest, bytes);
  return bytes;
}

/** Drop what is cached for `dir`, such as a migration's staging folder once it has been checked. */
export function forgetQuestDir(dir: string): void {
  cache.delete(dir);
}

export function _clearQuestDirCacheForTests(): void {
  cache.clear();
}

async function rescan(dir: string): Promise<QuestDirState | null> {
  // Stamp the meta file before reading anything: a write that lands during the
  // scan changes it again, so the next read rescans instead of trusting this one.
  const metaPath = join(dir, META_FILE);
  const metaStamp = await fileStamp(metaPath);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const meta = metaStamp === null ? null : await readMeta(metaPath);
  if (meta === null) {
    console.error(`[quest-store] ${metaPath} is missing; deriving the next quest number from the quest files`);
  }

  const previous = cache.get(dir);
  const fileStamps = new Map<string, string>();
  const questsByFile = new Map<string, QuestmasterTask>();
  const toRead: string[] = [];
  const questNames = names.filter((name) => QUEST_FILE_RE.test(name));
  for (let start = 0; start < questNames.length; start += READ_BATCH) {
    const batch = questNames.slice(start, start + READ_BATCH);
    const stamps = await Promise.all(batch.map((name) => fileStamp(join(dir, name))));
    batch.forEach((name, index) => {
      const stamp = stamps[index];
      if (!stamp) return;
      fileStamps.set(name, stamp);
      const known = previous?.fileStamps.get(name) === stamp ? previous.questsByFile.get(name) : undefined;
      if (known) questsByFile.set(name, known);
      else toRead.push(name);
    });
  }

  let unreadable = 0;
  for (let start = 0; start < toRead.length; start += READ_BATCH) {
    const batch = toRead.slice(start, start + READ_BATCH);
    const texts = await Promise.all(batch.map((name) => readFile(join(dir, name), "utf-8").catch((error) => error)));
    batch.forEach((name, index) => {
      const text = texts[index];
      try {
        if (typeof text !== "string") throw text;
        const quest = normalizeLiveQuest(JSON.parse(text) as QuestmasterTask);
        if (questFileName(quest.questId) !== name) throw new Error(`holds ${String(quest.questId)}`);
        questsByFile.set(name, deepFreeze(quest));
      } catch (error) {
        // The file is left as it is for manual repair; its quest reads as missing meanwhile.
        unreadable++;
        console.error(`[quest-store] Could not read quest file ${join(dir, name)}; leaving it untouched:`, error);
      }
    });
  }
  if (unreadable > 0) console.error(`[quest-store] ${unreadable} quest file(s) in ${dir} could not be read`);
  await removeStaleTempFiles(dir, names);

  const quests = sortQuestsByRecency([...questsByFile.values()]);
  const allIds = questNames.map((name) => ({ questId: QUEST_FILE_RE.exec(name)![1]! }));
  const state = deepFreeze({
    // Unreadable files still hold their numbers.
    nextQuestNumber: Math.max(meta?.nextQuestNumber ?? 1, nextQuestNumberFor(allIds)),
    quests,
    ...(meta?.legacyBackupDir ? { legacyBackupDir: meta.legacyBackupDir } : {}),
  });
  if (metaStamp) cache.set(dir, { metaStamp, fileStamps, questsByFile, state });
  return state;
}

async function readMeta(path: string): Promise<QuestDirMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<QuestDirMeta>;
    if (parsed.format !== QUEST_DIR_FORMAT || parsed.version !== QUEST_DIR_VERSION) {
      throw new Error(`unsupported format ${String(parsed.format)} version ${String(parsed.version)}`);
    }
    return {
      format: QUEST_DIR_FORMAT,
      version: QUEST_DIR_VERSION,
      nextQuestNumber:
        typeof parsed.nextQuestNumber === "number" && Number.isInteger(parsed.nextQuestNumber)
          ? parsed.nextQuestNumber
          : 1,
      ...(typeof parsed.legacyBackupDir === "string" && parsed.legacyBackupDir.trim()
        ? { legacyBackupDir: parsed.legacyBackupDir }
        : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Quest store meta file ${path} is unreadable: ${(error as Error).message}`);
  }
}

function writeMeta(dir: string, meta: QuestDirMeta): Promise<void> {
  return replaceFile(join(dir, META_FILE), Buffer.from(`${JSON.stringify(meta, null, 2)}\n`));
}

async function replaceFile(path: string, bytes: Buffer): Promise<void> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const tempPath = join(path.slice(0, path.lastIndexOf("/")), `.${name}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const file = await open(tempPath, "wx");
    try {
      const { bytesWritten } = await file.write(bytes, 0, bytes.length, 0);
      if (bytesWritten !== bytes.length) {
        throw new Error(`Short write to ${tempPath}: ${bytesWritten} of ${bytes.length} bytes`);
      }
    } finally {
      await file.close();
    }
    await rename(tempPath, path);
  } catch (error) {
    await unlinkIfPresent(tempPath).catch((cleanupError) =>
      console.warn(`[quest-store] Could not remove ${tempPath}:`, cleanupError),
    );
    throw error;
  }
}

async function removeStaleTempFiles(dir: string, names: string[]): Promise<void> {
  for (const name of names) {
    if (!TEMP_FILE_RE.test(name)) continue;
    const path = join(dir, name);
    try {
      if (Date.now() - (await stat(path)).mtimeMs < STALE_TEMP_MS) continue;
      await unlinkIfPresent(path);
      console.warn(`[quest-store] Removed ${path}, left by an interrupted write`);
    } catch (error) {
      console.warn(`[quest-store] Could not remove leftover temp file ${path}:`, error);
    }
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function fileStamp(path: string): Promise<string | null> {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

function questFileName(questId: string): string {
  return `${questId}.json`;
}

function questNumber(questId: string): number {
  const match = /^q-(\d+)$/.exec(questId);
  return match ? Number(match[1]) : 0;
}

function questRecency(quest: QuestmasterTask): number {
  return Math.max(quest.createdAt, (quest as { updatedAt?: number }).updatedAt ?? 0, quest.statusChangedAt ?? 0);
}
