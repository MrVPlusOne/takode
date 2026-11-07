import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { QuestImage, QuestmasterTask } from "./quest-types.js";
import { questFileBytes, writeNewQuestDir } from "./quest-store-dir.js";

type QuestStoreSnapshot = {
  format: string;
  legacyBackupDir?: string;
  nextQuestNumber: number;
  quests: QuestmasterTask[];
  updatedAt: number;
  version: number;
};

export interface QuestTextBackupEntry {
  id: string;
  kind: "text_snapshot";
  /**
   * `quest_index`: the snapshot names each quest's version in `text/quest-blobs/`.
   * Absent: an older snapshot holding the whole store in one file.
   */
  format?: "quest_index";
  reason: string;
  createdAt: number;
  questCount: number;
  nextQuestNumber: number;
  sha256: string;
  bytes: number;
  relativePath: string;
}

export interface QuestJournalBackupEntry {
  id: string;
  kind: "text_journal";
  date: string;
  relativePath: string;
}

export interface QuestImageBackupEntry {
  id: string;
  kind: "image_blob";
  sha256: string;
  bytes: number;
  mimeType?: string;
  extension: string;
  relativePath: string;
  sourceFilenames: string[];
  lastReferencedAt: number;
}

export interface QuestBackupManifest {
  version: 1;
  root: string;
  updatedAt: number;
  restoreReadme: string;
  text: {
    retention: { maxSnapshots: number; maxJournalDays: number };
    latestSnapshotId?: string;
    mutationCountSinceSnapshot?: number;
    snapshots: QuestTextBackupEntry[];
    journals: QuestJournalBackupEntry[];
  };
  images: {
    note: string;
    blobs: QuestImageBackupEntry[];
  };
}

/**
 * One quest change. Version 1 records held whole before/after copies of each changed quest, so a note added
 * to a quest of 10 MB wrote 20 MB; version 2 records only what changed. Replaying a day's records in order
 * onto the quest in the preceding snapshot rebuilds it.
 */
interface MutationJournalRecord {
  version: 2;
  kind: "quest_text_mutation";
  id: string;
  createdAt: number;
  before: StoreSummary;
  after: StoreSummary;
  quests: QuestMutation[];
}

type QuestMutation =
  /** A created quest (whole), or a deleted one (null). */
  | { questId: string; quest: QuestmasterTask | null }
  /** Fields given new values, items added at the end of array fields, and fields removed. */
  | { questId: string; set?: Record<string, unknown>; appended?: Record<string, unknown[]>; removed?: string[] };

interface StoreSummary {
  nextQuestNumber: number;
  questCount: number;
  updatedAt: number;
}

const DEFAULT_MAX_TEXT_SNAPSHOTS = 6;
const DEFAULT_MAX_JOURNAL_DAYS = 30;
const TEXT_SNAPSHOT_MUTATION_INTERVAL = 25;

function backupRoot(): string {
  return join(homedir(), ".companion", "questmaster-backups");
}

function manifestPath(root = backupRoot()): string {
  return join(root, "manifest.json");
}

function textDir(root = backupRoot()): string {
  return join(root, "text");
}

function snapshotDir(root = backupRoot()): string {
  return join(textDir(root), "snapshots");
}

function journalDir(root = backupRoot()): string {
  return join(textDir(root), "journal");
}

/** Quest versions by SHA-256 of their bytes, shared by every quest-index snapshot. */
function questBlobDir(root = backupRoot()): string {
  return join(textDir(root), "quest-blobs");
}

function imageBlobDir(root = backupRoot()): string {
  return join(root, "images", "blobs");
}

function restoreReadmePath(root = backupRoot()): string {
  return join(root, "README.md");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function timestampForPath(now = Date.now()): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

function relativeToRoot(root: string, path: string): string {
  return path.slice(root.length + 1);
}

function emptyManifest(root: string): QuestBackupManifest {
  return {
    version: 1,
    root,
    updatedAt: Date.now(),
    restoreReadme: relativeToRoot(root, restoreReadmePath(root)),
    text: {
      retention: { maxSnapshots: DEFAULT_MAX_TEXT_SNAPSHOTS, maxJournalDays: DEFAULT_MAX_JOURNAL_DAYS },
      snapshots: [],
      journals: [],
    },
    images: {
      note: "Quest images are content-addressed and deduplicated. Text backups are the primary recovery source.",
      blobs: [],
    },
  };
}

async function readManifest(root = backupRoot()): Promise<QuestBackupManifest> {
  try {
    const raw = await readFile(manifestPath(root), "utf-8");
    const parsed = JSON.parse(raw) as QuestBackupManifest;
    if (parsed.version === 1 && parsed.text && parsed.images) return parsed;
  } catch {
    // Missing or unreadable manifests are repaired by the next backup write.
  }
  return emptyManifest(root);
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tempPath = join(dirname(path), "." + basename(path) + "." + process.pid + "." + randomUUID() + ".tmp");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tempPath, path);
}

async function writeRestoreReadme(root: string): Promise<void> {
  const readme = [
    "# Questmaster Local Backups",
    "",
    "This directory contains local-only backups for Questmaster quest and Quest Journey data.",
    "",
    "- manifest.json is the discovery entry point. It lists retained text snapshots, mutation journals, and deduplicated image blobs.",
    "- text/snapshots/ stores periodic snapshots of the whole quest store. Newer ones (format quest_index in the manifest) are small indexes naming each quest's version in text/quest-blobs/; older ones hold the whole store in one file.",
    "- text/quest-blobs/ stores each quest version once, named by the SHA-256 of its bytes, shared by every snapshot that names it.",
    "- text/journal/ stores compact JSONL records for Questmaster text mutations between full snapshots.",
    "- images/blobs/ stores content-addressed quest image blobs. Image coverage is space-saving and secondary to text recovery.",
    "",
    "Restore safety:",
    "1. Inspect manifest.json and choose the newest relevant text snapshot.",
    "2. Write it to a temporary quest folder and inspect quest counts/timestamps before replacing any live store:",
    '   bun -e \'await (await import("<takode>/web/server/quest-backup-store.ts")).restoreQuestSnapshotToFolder("<snapshot>", "/tmp/quests-restored")\'',
    "3. Before applying a restore, stop the Takode server and move the current ~/.companion/questmaster-live/quests folder aside; then move the restored folder into its place.",
    "4. Image blobs are deduplicated by SHA-256 and may need manual relinking from quest image metadata.",
    "",
  ].join("\n");
  await mkdir(root, { recursive: true });
  await writeFile(restoreReadmePath(root), readme, "utf-8");
}

async function saveManifest(manifest: QuestBackupManifest, root = backupRoot()): Promise<void> {
  manifest.updatedAt = Date.now();
  manifest.restoreReadme = relativeToRoot(root, restoreReadmePath(root));
  await writeRestoreReadme(root);
  await writeJsonAtomic(manifestPath(root), manifest);
}

function summarizeStore(store: QuestStoreSnapshot): StoreSummary {
  return { nextQuestNumber: store.nextQuestNumber, questCount: store.quests.length, updatedAt: store.updatedAt };
}

function questChanged(before: QuestmasterTask | undefined, after: QuestmasterTask | undefined): boolean {
  if (before === after) return false;
  if (!before || !after) return true;
  return (
    before.version !== after.version ||
    before.updatedAt !== after.updatedAt ||
    JSON.stringify(before) !== JSON.stringify(after)
  );
}

function questMutation(questId: string, before: QuestmasterTask | null, after: QuestmasterTask | null): QuestMutation {
  if (!before || !after) return { questId, quest: after };
  const previous = before as unknown as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  const appended: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(next)) {
    const old = previous[key];
    if (value === old) continue;
    // Quest edits copy arrays but keep their existing items, so a growing list (notes, rounds) is recorded
    // as its new items.
    if (
      Array.isArray(value) &&
      Array.isArray(old) &&
      value.length > old.length &&
      old.every((item, i) => item === value[i])
    )
      appended[key] = value.slice(old.length);
    else set[key] = value;
  }
  const removed = Object.keys(previous).filter((key) => !(key in next));
  return {
    questId,
    ...(Object.keys(set).length ? { set } : {}),
    ...(Object.keys(appended).length ? { appended } : {}),
    ...(removed.length ? { removed } : {}),
  };
}

function changedQuests(before: QuestStoreSnapshot, after: QuestStoreSnapshot): QuestMutation[] {
  const beforeById = new Map(before.quests.map((quest) => [quest.questId, quest]));
  const afterById = new Map(after.quests.map((quest) => [quest.questId, quest]));
  const questIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  return [...questIds]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((questId) => {
      const beforeQuest = beforeById.get(questId);
      const afterQuest = afterById.get(questId);
      if (!questChanged(beforeQuest, afterQuest)) return [];
      return [questMutation(questId, beforeQuest ?? null, afterQuest ?? null)];
    });
}

async function pruneSnapshots(manifest: QuestBackupManifest, root: string, maxSnapshots: number) {
  const snapshots = [...manifest.text.snapshots].sort((a, b) => b.createdAt - a.createdAt);
  const retained = snapshots.slice(0, maxSnapshots);
  const retainedIds = new Set(retained.map((entry) => entry.id));
  for (const entry of snapshots) {
    if (!retainedIds.has(entry.id)) await unlink(join(root, entry.relativePath)).catch(() => {});
  }
  await removeUnreferencedQuestBlobs(root, retained);
  return {
    ...manifest,
    text: {
      ...manifest.text,
      latestSnapshotId: retained[0]?.id,
      snapshots: retained,
      retention: { ...manifest.text.retention, maxSnapshots },
    },
  };
}

/** Delete quest blobs no retained snapshot names. Any unreadable index stops the cleanup, keeping every blob. */
async function removeUnreferencedQuestBlobs(root: string, retained: QuestTextBackupEntry[]): Promise<void> {
  const referenced = new Set<string>();
  for (const entry of retained) {
    if (entry.format !== "quest_index") continue;
    try {
      const index = JSON.parse(await readFile(join(root, entry.relativePath), "utf-8")) as QuestIndexSnapshot;
      for (const digest of Object.values(index.quests)) referenced.add(digest);
    } catch (error) {
      console.warn(`[quest-backup] Keeping all quest blobs: snapshot ${entry.relativePath} is unreadable:`, error);
      return;
    }
  }
  const names = await readdir(questBlobDir(root)).catch(() => [] as string[]);
  for (const name of names) {
    if (name.endsWith(".json") && !referenced.has(name.slice(0, -".json".length))) {
      await unlink(join(questBlobDir(root), name)).catch(() => {});
    }
  }
}

async function pruneJournals(manifest: QuestBackupManifest, root: string, maxJournalDays: number) {
  const journals = [...manifest.text.journals].sort((a, b) => b.date.localeCompare(a.date));
  const retained = journals.slice(0, maxJournalDays);
  const retainedIds = new Set(retained.map((entry) => entry.id));
  for (const entry of journals) {
    if (!retainedIds.has(entry.id)) await unlink(join(root, entry.relativePath)).catch(() => {});
  }
  return {
    ...manifest,
    text: {
      ...manifest.text,
      journals: retained,
      retention: { ...manifest.text.retention, maxJournalDays },
    },
  };
}

interface QuestIndexSnapshot {
  kind: "questmaster-quest-index";
  version: 2;
  createdAt: number;
  nextQuestNumber: number;
  legacyBackupDir?: string;
  /** SHA-256 of each quest's file bytes, by quest ID; the bytes are in `text/quest-blobs/<sha256>.json`. */
  quests: Record<string, string>;
}

const questDigests = new WeakMap<object, string>();
const HASH_BATCH = 32;

/**
 * Record a snapshot of the whole store. Each quest's exact file bytes are kept
 * once in `text/quest-blobs/<sha256>.json`, and the snapshot itself is a small
 * index naming the version of every quest, so a snapshot writes only the quests
 * that changed since earlier ones and retained snapshots share the rest.
 */
export async function recordQuestStoreSnapshotBackup(
  store: QuestStoreSnapshot,
  options: { reason: string; maxSnapshots?: number; root?: string } = { reason: "manual" },
): Promise<QuestTextBackupEntry> {
  const root = options.root ?? backupRoot();
  await mkdir(snapshotDir(root), { recursive: true });
  await mkdir(questBlobDir(root), { recursive: true });
  const stored = new Set(await readdir(questBlobDir(root)));
  const quests: Record<string, string> = {};
  const sorted = [...store.quests].sort((a, b) => a.questId.localeCompare(b.questId));
  for (let start = 0; start < sorted.length; start += HASH_BATCH) {
    for (const quest of sorted.slice(start, start + HASH_BATCH)) {
      const digest = questDigest(quest);
      quests[quest.questId] = digest;
      if (!stored.has(`${digest}.json`)) {
        await writeFileAtomic(join(questBlobDir(root), `${digest}.json`), questFileBytes(quest));
        stored.add(`${digest}.json`);
      }
    }
    // Hashing a large store takes a while the first time; let other work run between batches.
    await new Promise((resolve) => setImmediate(resolve));
  }

  const content = {
    nextQuestNumber: store.nextQuestNumber,
    ...(store.legacyBackupDir ? { legacyBackupDir: store.legacyBackupDir } : {}),
    quests,
  };
  const digest = sha256(JSON.stringify(content));
  let manifest = await readManifest(root);
  const existing = manifest.text.snapshots.find((entry) => entry.sha256 === digest);
  if (existing) return existing;

  const createdAt = Date.now();
  const index: QuestIndexSnapshot = { kind: "questmaster-quest-index", version: 2, createdAt, ...content };
  const id = "snapshot-" + timestampForPath(createdAt) + "-" + digest.slice(0, 12);
  const path = join(snapshotDir(root), id + ".json");
  const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  await writeFileAtomic(path, bytes);
  const entry: QuestTextBackupEntry = {
    id,
    kind: "text_snapshot",
    format: "quest_index",
    reason: options.reason,
    createdAt,
    questCount: store.quests.length,
    nextQuestNumber: store.nextQuestNumber,
    sha256: digest,
    bytes: bytes.length,
    relativePath: relativeToRoot(root, path),
  };
  manifest = {
    ...manifest,
    text: {
      ...manifest.text,
      latestSnapshotId: entry.id,
      mutationCountSinceSnapshot: 0,
      snapshots: [entry, ...manifest.text.snapshots],
    },
  };
  manifest = await pruneSnapshots(manifest, root, options.maxSnapshots ?? manifest.text.retention.maxSnapshots);
  await saveManifest(manifest, root);
  return entry;
}

/**
 * Write the store a snapshot holds into `outDir` as a quest folder, the layout
 * of `~/.companion/questmaster-live/quests`, for inspecting or restoring it.
 * Reads both quest-index snapshots and older whole-store snapshots. `outDir`
 * must not exist.
 */
export async function restoreQuestSnapshotToFolder(snapshotPath: string, outDir: string): Promise<number> {
  const parsed = JSON.parse(await readFile(snapshotPath, "utf-8")) as
    | QuestIndexSnapshot
    | { kind: "questmaster-text-snapshot"; store: QuestStoreSnapshot };
  if (parsed.kind === "questmaster-text-snapshot") {
    await writeNewQuestDir(outDir, parsed.store);
    return parsed.store.quests.length;
  }
  const blobDir = join(dirname(dirname(snapshotPath)), "quest-blobs");
  const quests: object[] = [];
  for (const [questId, digest] of Object.entries(parsed.quests)) {
    const bytes = await readFile(join(blobDir, `${digest}.json`));
    if (sha256(bytes) !== digest) throw new Error(`Quest blob for ${questId} does not match its hash ${digest}`);
    quests.push(JSON.parse(bytes.toString("utf-8")) as object);
  }
  await writeNewQuestDir(outDir, {
    nextQuestNumber: parsed.nextQuestNumber,
    quests,
    ...(parsed.legacyBackupDir ? { legacyBackupDir: parsed.legacyBackupDir } : {}),
  });
  return quests.length;
}

function questDigest(quest: object): string {
  const cached = questDigests.get(quest);
  if (cached) return cached;
  const digest = sha256(questFileBytes(quest));
  if (Object.isFrozen(quest)) questDigests.set(quest, digest);
  return digest;
}

async function writeFileAtomic(path: string, bytes: Buffer): Promise<void> {
  const tempPath = join(dirname(path), "." + basename(path) + "." + process.pid + "." + randomUUID() + ".tmp");
  await writeFile(tempPath, bytes);
  await rename(tempPath, path);
}

async function appendMutationJournal(
  record: MutationJournalRecord,
  options: { maxJournalDays?: number; root?: string } = {},
): Promise<void> {
  const root = options.root ?? backupRoot();
  await mkdir(journalDir(root), { recursive: true });
  let manifest = await readManifest(root);
  const date = todayKey(record.createdAt);
  const path = join(journalDir(root), date + ".jsonl");
  await writeFile(path, JSON.stringify(record) + "\n", { encoding: "utf-8", flag: "a" });
  const id = "journal-" + date;
  if (!manifest.text.journals.some((entry) => entry.id === id)) {
    manifest = {
      ...manifest,
      text: {
        ...manifest.text,
        journals: [
          { id, kind: "text_journal", date, relativePath: relativeToRoot(root, path) },
          ...manifest.text.journals,
        ],
      },
    };
  }
  manifest = await pruneJournals(manifest, root, options.maxJournalDays ?? manifest.text.retention.maxJournalDays);
  await saveManifest(manifest, root);
}

export async function recordQuestStoreMutationBackup(
  before: QuestStoreSnapshot,
  after: QuestStoreSnapshot,
  options: { root?: string } = {},
): Promise<void> {
  const quests = changedQuests(before, after);
  if (quests.length === 0 && before.nextQuestNumber === after.nextQuestNumber) return;
  const createdAt = Date.now();
  await appendMutationJournal(
    {
      version: 2,
      kind: "quest_text_mutation",
      id: "mutation-" + timestampForPath(createdAt) + "-" + randomUUID(),
      createdAt,
      before: summarizeStore(before),
      after: summarizeStore(after),
      quests,
    },
    options,
  );
  const root = options.root ?? backupRoot();
  const manifest = await readManifest(root);
  const mutationCountSinceSnapshot = (manifest.text.mutationCountSinceSnapshot ?? 0) + 1;
  await saveManifest({ ...manifest, text: { ...manifest.text, mutationCountSinceSnapshot } }, root);
  if (!manifest.text.snapshots.length || mutationCountSinceSnapshot >= TEXT_SNAPSHOT_MUTATION_INTERVAL) {
    await recordQuestStoreSnapshotBackup(after, { reason: "scheduled-mutation", root: options.root });
  }
}

export async function backupQuestImageFile(image: Pick<QuestImage, "filename" | "mimeType" | "path">): Promise<void> {
  let data: Buffer;
  try {
    data = await readFile(image.path);
  } catch {
    return;
  }
  const root = backupRoot();
  await mkdir(imageBlobDir(root), { recursive: true });
  const digest = sha256(data);
  const extension = extname(image.path) || extname(image.filename) || ".bin";
  const blobPath = join(imageBlobDir(root), digest + extension);
  if (!(await pathExists(blobPath))) await writeFile(blobPath, data);
  const blobStat = await stat(blobPath);
  const manifest = await readManifest(root);
  const existing = manifest.images.blobs.find((entry) => entry.sha256 === digest);
  const sourceFilenames = new Set(existing?.sourceFilenames ?? []);
  sourceFilenames.add(image.filename);
  const entry: QuestImageBackupEntry = {
    id: existing?.id ?? "image-" + digest.slice(0, 16),
    kind: "image_blob",
    sha256: digest,
    bytes: blobStat.size,
    mimeType: image.mimeType,
    extension,
    relativePath: relativeToRoot(root, blobPath),
    sourceFilenames: [...sourceFilenames].sort(),
    lastReferencedAt: Date.now(),
  };
  await saveManifest(
    {
      ...manifest,
      images: { ...manifest.images, blobs: [entry, ...manifest.images.blobs.filter((item) => item.sha256 !== digest)] },
    },
    root,
  );
}

export async function listQuestmasterBackups(root = backupRoot()): Promise<QuestBackupManifest> {
  return readManifest(root);
}

export function assertSafeQuestmasterTestRoot(companionDir = join(homedir(), ".companion")): void {
  const resolvedRoot = resolve(companionDir);
  const resolvedTmp = resolve(tmpdir());
  const insideTmp = resolvedRoot === resolvedTmp || resolvedRoot.startsWith(resolvedTmp + sep);
  if (!insideTmp) {
    throw new Error("Refusing to reset Questmaster data outside a verified temporary test root: " + resolvedRoot);
  }
}

export async function clearQuestmasterBackupRootForTests(): Promise<void> {
  const root = backupRoot();
  assertSafeQuestmasterTestRoot(dirname(root));
  await rm(root, { recursive: true, force: true });
}
