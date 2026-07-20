import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { QuestImage, QuestmasterTask } from "./quest-types.js";

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

interface MutationJournalRecord {
  version: 1;
  kind: "quest_text_mutation";
  id: string;
  createdAt: number;
  before: StoreSummary;
  after: StoreSummary;
  quests: Array<{ questId: string; before: QuestmasterTask | null; after: QuestmasterTask | null }>;
}

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
    "- text/snapshots/ stores periodic full textual snapshots of the mutable Questmaster live store.",
    "- text/journal/ stores compact JSONL records for Questmaster text mutations between full snapshots.",
    "- images/blobs/ stores content-addressed quest image blobs. Image coverage is space-saving and secondary to text recovery.",
    "",
    "Restore safety:",
    "1. Inspect manifest.json and choose the newest relevant text snapshot.",
    "2. Copy the candidate snapshot to a temporary location and inspect quest counts/timestamps before replacing any live store.",
    "3. Before applying a restore, take a fresh manual copy of the current Questmaster live store.",
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

function changedQuests(before: QuestStoreSnapshot, after: QuestStoreSnapshot): MutationJournalRecord["quests"] {
  const beforeById = new Map(before.quests.map((quest) => [quest.questId, quest]));
  const afterById = new Map(after.quests.map((quest) => [quest.questId, quest]));
  const questIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  return [...questIds]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((questId) => {
      const beforeQuest = beforeById.get(questId);
      const afterQuest = afterById.get(questId);
      if (!questChanged(beforeQuest, afterQuest)) return [];
      return [{ questId, before: beforeQuest ?? null, after: afterQuest ?? null }];
    });
}

async function pruneSnapshots(manifest: QuestBackupManifest, root: string, maxSnapshots: number) {
  const snapshots = [...manifest.text.snapshots].sort((a, b) => b.createdAt - a.createdAt);
  const retained = snapshots.slice(0, maxSnapshots);
  const retainedIds = new Set(retained.map((entry) => entry.id));
  for (const entry of snapshots) {
    if (!retainedIds.has(entry.id)) await unlink(join(root, entry.relativePath)).catch(() => {});
  }
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

export async function recordQuestStoreSnapshotBackup(
  store: QuestStoreSnapshot,
  options: { reason: string; maxSnapshots?: number; root?: string } = { reason: "manual" },
): Promise<QuestTextBackupEntry> {
  const root = options.root ?? backupRoot();
  await mkdir(snapshotDir(root), { recursive: true });
  let manifest = await readManifest(root);
  const storeData = JSON.stringify(store);
  const digest = sha256(storeData);
  const existing = manifest.text.snapshots.find((entry) => entry.sha256 === digest);
  if (existing) return existing;

  const id = "snapshot-" + timestampForPath() + "-" + digest.slice(0, 12);
  const path = join(snapshotDir(root), id + ".json");
  const data =
    JSON.stringify({ kind: "questmaster-text-snapshot", version: 1, createdAt: Date.now(), store }, null, 2) + "\n";
  await writeFile(path, data, "utf-8");
  const entry: QuestTextBackupEntry = {
    id,
    kind: "text_snapshot",
    reason: options.reason,
    createdAt: Date.now(),
    questCount: store.quests.length,
    nextQuestNumber: store.nextQuestNumber,
    sha256: digest,
    bytes: Buffer.byteLength(data),
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
      version: 1,
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
