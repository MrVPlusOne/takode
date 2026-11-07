/**
 * A backup snapshot: the coordinator's durable data written as plain files
 * into a folder (the working tree of the backup repository's data branch),
 * and the way back from such a folder to a `.companion` folder.
 *
 * Paths mirror `.companion`, so restoring is copying. The quest store keeps
 * one file per quest (`questmaster-live/quests/`), which is copied as it is;
 * a server that has not moved its single-file store there yet has that file
 * split the same way, because one 100 MB file would be rewritten in full every
 * hour and is over GitHub's file size limit. Snapshots written before the
 * quest store kept one file per quest hold `questmaster-live/store-meta.json`
 * instead, and restore joins those back into `store.json`. Secrets stay out: the settings file is
 * kept with its credential fields blank, and env profiles, browser login and
 * the secrets file are not copied (see `docs/backups.md` for what to re-enter).
 * Of sessions only the list (without live process IDs) and their names are
 * kept, not their histories.
 *
 * Memory repos are not part of the snapshot: the backup job pushes their Git
 * history as branches of the same repository, and the manifest records which
 * memory commit each snapshot saw.
 */

import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SESSION_NUMBERS_FILE } from "../constants.js";
import { COORDINATOR_SHARED_STATE, coordinatorServerState } from "../coordinator-state.js";
import { forgetQuestDir, nextQuestNumberFor, readQuestDir } from "../quest-store-dir.js";

export const BACKUP_MANIFEST_FILE = "manifest.json";
const README_FILE = "README.md";
const QUEST_STORE_FILE = "questmaster-live/store.json";
const QUESTS_DIR = "questmaster-live/quests";
/** Meta file of the quest folder: the next quest number and the pre-July legacy folder. */
const QUEST_DIR_META_FILE = `${QUESTS_DIR}/_meta.json`;
/** Meta file of snapshots written before the quest store kept one file per quest. */
const QUEST_META_FILE = "questmaster-live/store-meta.json";
const QUEST_FILE_RE = /^questmaster-live\/quests\/q-\d+\.json$/;

export interface BackupManifest {
  kind: "takode-backup";
  version: 1;
  createdAt: string;
  serverId: string;
  serverSlug: string;
  port: number;
  /** The machine the coordinator ran on. */
  machine: string | null;
  quests: { count: number; nextQuestNumber: number | null };
  /** The memory commit of each space this snapshot saw; its history is the space's memory branch. */
  memory: Array<{ space: string; head: string }>;
  /** SHA-256 of every file of the snapshot by path, the manifest and README aside. */
  files: Record<string, string>;
}

export interface WriteBackupSnapshotInput {
  /** The `.companion` folder to back up. */
  companion: string;
  /** Port of the server; its settings and sessions are per port. */
  port: number;
  /** Folder the snapshot is written to; files of an earlier snapshot there are updated or removed. */
  target: string;
  memory?: BackupManifest["memory"];
  now?: Date;
}

/**
 * Write the coordinator's durable data into `target` as a snapshot and
 * return its manifest. Only files that changed are rewritten (copied files
 * keep their source's modification time, which is how unchanged ones are
 * recognized), and files the data no longer has are removed, so a Git commit
 * of `target` records exactly what changed. A `.git` folder in `target` is
 * left alone.
 */
export async function writeBackupSnapshot(input: WriteBackupSnapshotInput): Promise<BackupManifest> {
  const { companion, port, target } = input;
  const settingsFile = `settings-${port}.json`;
  const settings = JSON.parse(await readFile(join(companion, settingsFile), "utf-8")) as Record<string, unknown>;
  const serverId = requireString(settings.serverId, `${settingsFile} has no serverId`);
  const serverSlug = requireString(settings.serverSlug, `${settingsFile} has no serverSlug`);

  const entries: SnapshotEntry[] = [{ path: settingsFile, content: JSON.stringify(withoutSecrets(settings), null, 2) }];
  const quests = await planQuests(companion, entries);
  await planSessionList(companion, `sessions/${port}/launcher.json`, entries);
  const copied = [
    ...COORDINATOR_SHARED_STATE,
    `library/${serverId}`,
    ...coordinatorServerState(serverId),
    `hosts/${serverId}.json`,
    `sessions/${port}/${SESSION_NUMBERS_FILE}`,
  ].filter((path) => !isSecretState(path));
  for (const path of copied) {
    for (const file of await listFiles(companion, path)) {
      if (!isQuestStoreLeftover(file)) entries.push({ path: file, source: join(companion, file) });
    }
  }

  const previous = await readBackupManifest(target).catch(() => null);
  const files: Record<string, string> = {};
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    files[entry.path] = await writeEntry(entry, join(target, entry.path), previous?.files[entry.path]);
  }
  await removeOthers(target, new Set([...Object.keys(files), BACKUP_MANIFEST_FILE, README_FILE]));

  const machine = await readFile(join(companion, "machine.json"), "utf-8")
    .then((text) => (JSON.parse(text) as { name?: unknown }).name)
    .catch(() => null);
  const manifest: BackupManifest = {
    kind: "takode-backup",
    version: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    serverId,
    serverSlug,
    port,
    machine: typeof machine === "string" ? machine : null,
    quests,
    memory: input.memory ?? [],
    files,
  };
  await writeFile(join(target, README_FILE), README);
  // An unchanged snapshot keeps its manifest, so a run that changed nothing commits nothing.
  if (previous && sameContent(previous, manifest)) return previous;
  await writeFile(join(target, BACKUP_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readBackupManifest(snapshot: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(join(snapshot, BACKUP_MANIFEST_FILE), "utf-8")) as BackupManifest;
  if (manifest.kind !== "takode-backup" || manifest.version !== 1 || typeof manifest.files !== "object") {
    throw new Error(`${join(snapshot, BACKUP_MANIFEST_FILE)} is not a Takode backup manifest.`);
  }
  return manifest;
}

/**
 * Problems that make a snapshot unfit to restore: files missing or not
 * matching their recorded hash, and a quest count that disagrees with the
 * manifest. Empty when the snapshot is whole.
 */
export async function checkBackupSnapshot(snapshot: string): Promise<string[]> {
  const manifest = await readBackupManifest(snapshot);
  const problems: string[] = [];
  for (const [path, hash] of Object.entries(manifest.files)) {
    const content = await readFile(join(snapshot, path)).catch(() => null);
    if (!content) problems.push(`${path} is missing`);
    else if (sha256(content) !== hash) problems.push(`${path} does not match its recorded hash`);
  }
  const questFiles = Object.keys(manifest.files).filter((path) => QUEST_FILE_RE.test(path)).length;
  if (questFiles !== manifest.quests.count) {
    problems.push(`the manifest counts ${manifest.quests.count} quests but the snapshot holds ${questFiles}`);
  }
  return problems;
}

/**
 * Turn a snapshot back into a `.companion` folder at `target`, which must be
 * missing or empty: the snapshot is checked first, then its files are copied
 * (an older snapshot's quests are joined back into `questmaster-live/store.json`,
 * which the server moves into one file per quest when it starts).
 * Memory repos are restored separately from their branches.
 */
export async function restoreBackupSnapshot(
  snapshot: string,
  target: string,
): Promise<{ manifest: BackupManifest; files: number }> {
  const problems = await checkBackupSnapshot(snapshot);
  if (problems.length > 0) throw new Error(`The backup is damaged:\n${problems.join("\n")}`);
  const existing = await readdir(target).catch(() => []);
  if (existing.length > 0) throw new Error(`${target} is not empty; restore into a new folder.`);

  const manifest = await readBackupManifest(snapshot);
  const joinQuests = Boolean(manifest.files[QUEST_META_FILE]);
  let files = 0;
  for (const path of Object.keys(manifest.files)) {
    if (joinQuests && (path === QUEST_META_FILE || path.startsWith(`${QUESTS_DIR}/`))) continue;
    await mkdir(dirname(join(target, path)), { recursive: true });
    await copyFile(join(snapshot, path), join(target, path));
    files++;
  }
  if (joinQuests) {
    const { questOrder, ...meta } = JSON.parse(await readFile(join(snapshot, QUEST_META_FILE), "utf-8")) as {
      questOrder: string[];
    };
    const quests: unknown[] = [];
    for (const id of questOrder) {
      quests.push(JSON.parse(await readFile(join(snapshot, questFile(id)), "utf-8")));
    }
    await mkdir(join(target, "questmaster-live"), { recursive: true });
    await writeFile(join(target, QUEST_STORE_FILE), JSON.stringify({ ...meta, quests }));
    files++;
  }
  return { manifest, files };
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** One snapshot file: generated `content`, or a copy of `source`. */
interface SnapshotEntry {
  path: string;
  content?: string;
  source?: string;
}

/**
 * Count the quest folder, which is copied with the rest of `questmaster-live`;
 * or, when the server has not moved a single-file store into it yet, plan that
 * file as the same folder. Returns the counts for the manifest.
 */
async function planQuests(companion: string, entries: SnapshotEntry[]): Promise<BackupManifest["quests"]> {
  const folder = await readdir(join(companion, QUESTS_DIR)).catch(() => null);
  if (folder) {
    const meta = await readFile(join(companion, QUEST_DIR_META_FILE), "utf-8")
      .then((text) => JSON.parse(text) as { nextQuestNumber?: unknown })
      .catch(() => null);
    const questIds = folder
      .filter((name) => QUEST_FILE_RE.test(`${QUESTS_DIR}/${name}`))
      .map((name) => name.slice(0, -5));
    const next = meta?.nextQuestNumber;
    return { count: questIds.length, nextQuestNumber: nextQuestNumber(typeof next === "number" ? next : 1, questIds) };
  }
  const text = await readFile(join(companion, QUEST_STORE_FILE), "utf-8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return { count: 0, nextQuestNumber: null };
  const store = JSON.parse(text) as {
    quests: Array<{ questId: string }>;
    nextQuestNumber?: unknown;
    legacyBackupDir?: unknown;
  };
  for (const quest of store.quests) {
    entries.push({ path: questFile(quest.questId), content: `${JSON.stringify(quest, null, 2)}\n` });
  }
  const next = nextQuestNumber(
    typeof store.nextQuestNumber === "number" ? store.nextQuestNumber : 1,
    store.quests.map((quest) => quest.questId),
  );
  const meta = {
    format: "quest_per_file",
    version: 2,
    nextQuestNumber: next,
    ...(typeof store.legacyBackupDir === "string" ? { legacyBackupDir: store.legacyBackupDir } : {}),
  };
  entries.push({ path: QUEST_DIR_META_FILE, content: `${JSON.stringify(meta, null, 2)}\n` });
  return { count: store.quests.length, nextQuestNumber: next };
}

/** The next quest number as the quest store reads it: never at or below an existing quest's number. */
function nextQuestNumber(stored: number, questIds: string[]): number {
  return Math.max(stored, nextQuestNumberFor(questIds.map((questId) => ({ questId }))));
}

/**
 * Quest store files that are not current data: the single-file store (split
 * by planQuests), the copy a migration renamed aside, and folders a
 * migration or rollback left beside the quest folder.
 */
function isQuestStoreLeftover(path: string): boolean {
  return path === QUEST_STORE_FILE || path.startsWith(`${QUEST_STORE_FILE}.`) || path.startsWith(`${QUESTS_DIR}.`);
}

/** Quest count and next quest number of a restored `.companion` folder, in either quest store layout. */
export async function readRestoredQuestCounts(
  companion: string,
): Promise<{ count: number; nextQuestNumber: number | null } | null> {
  const folder = await readQuestDir(join(companion, QUESTS_DIR));
  forgetQuestDir(join(companion, QUESTS_DIR));
  if (folder) return { count: folder.quests.length, nextQuestNumber: folder.nextQuestNumber };
  const store = await readFile(join(companion, QUEST_STORE_FILE), "utf-8")
    .then((text) => JSON.parse(text) as { quests?: unknown[]; nextQuestNumber?: unknown })
    .catch(() => null);
  if (!store) return null;
  const next = store.nextQuestNumber;
  return { count: store.quests?.length ?? 0, nextQuestNumber: typeof next === "number" ? next : null };
}

/**
 * The session list without its live processes: a restored list naming process
 * IDs would have the server wait for, or signal, whatever process now has that
 * ID. Every session restores as exited and resumes on its next message, as
 * after a coordinator handoff.
 */
async function planSessionList(companion: string, path: string, entries: SnapshotEntry[]): Promise<void> {
  const text = await readFile(join(companion, path), "utf-8").catch(() => null);
  if (text === null) return;
  const sessions = JSON.parse(text) as Array<Record<string, unknown>>;
  for (const session of sessions) {
    for (const key of ["pid", "hostProcId", "hostClaudeRequests", "hostCodexRequests"]) delete session[key];
    session.state = "exited";
  }
  entries.push({ path, content: JSON.stringify(sessions, null, 2) });
}

function questFile(questId: string): string {
  return `${QUESTS_DIR}/${encodeURIComponent(questId)}.json`;
}

/** Write one entry unless the target already holds it; returns its hash. */
async function writeEntry(entry: SnapshotEntry, target: string, previousHash: string | undefined): Promise<string> {
  if (entry.content !== undefined) {
    const hash = sha256(entry.content);
    if (hash !== previousHash || !(await exists(target))) await writeCreatingDirs(target, entry.content);
    return hash;
  }
  const source = await stat(entry.source!);
  const current = await stat(target).catch(() => null);
  if (previousHash && current && current.size === source.size && sameTime(current.mtimeMs, source.mtimeMs)) {
    return previousHash;
  }
  const content = await readFile(entry.source!);
  await writeCreatingDirs(target, content);
  await utimes(target, source.atime, source.mtime);
  return sha256(content);
}

async function writeCreatingDirs(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Remove files of `root` (outside `.git`) not in `keep`, then folders left empty. */
async function removeOthers(root: string, keep: Set<string>, prefix = ""): Promise<boolean> {
  let empty = true;
  for (const name of await readdir(join(root, prefix)).catch(() => [])) {
    if (!prefix && name === ".git") {
      empty = false;
      continue;
    }
    const path = prefix ? `${prefix}/${name}` : name;
    if ((await lstat(join(root, path))).isDirectory()) {
      if (await removeOthers(root, keep, path)) await rm(join(root, path), { recursive: true });
      else empty = false;
    } else if (!keep.has(path)) {
      await rm(join(root, path));
    } else {
      empty = false;
    }
  }
  return empty;
}

/**
 * Files below `path` (relative to `root`), or `path` itself, following links
 * (the user's instructions and skills are links into a checkout). Temporary
 * files, locks and `.git` folders are left out.
 */
async function listFiles(root: string, path: string, seen = new Set<string>()): Promise<string[]> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.endsWith(".tmp") || name.endsWith(".lock") || name === ".git") return [];
  const info = await stat(join(root, path)).catch(() => null);
  if (!info) return [];
  if (!info.isDirectory()) return [path];
  const real = await realpath(join(root, path));
  if (seen.has(real)) return [];
  seen.add(real);
  const files: string[] = [];
  for (const child of (await readdir(join(root, path))).sort()) {
    files.push(...(await listFiles(root, `${path}/${child}`, seen)));
  }
  return files;
}

/** State left out of backups because it holds secrets. */
function isSecretState(path: string): boolean {
  return path === "envs" || path.startsWith("browser-login/");
}

/** The settings file with its credentials blank; the secrets file is never copied. */
function withoutSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(settings);
  for (const key of ["pushoverUserKey", "pushoverApiToken"]) if (typeof copy[key] === "string") copy[key] = "";
  for (const [group, keys] of [
    ["namerConfig", ["apiKey"]],
    ["transcriptionConfig", ["apiKey", "testApiKey"]],
  ] as const) {
    const value = copy[group] as Record<string, unknown> | undefined;
    for (const key of keys) if (value && typeof value[key] === "string") value[key] = "";
  }
  return copy;
}

const README = `# Takode backup

This branch holds a Takode coordinator's durable data, written by the Takode
server about once an hour. Paths mirror \`~/.companion\`; the quest store keeps
one file per quest under \`questmaster-live/quests/\`.
\`manifest.json\` lists every file with its SHA-256 and the memory commit each
memory branch had.

Restore with \`takode backup restore --repo <this repository> --to <empty folder>\`
and follow \`docs/backups.md\` in the Takode repository. Secrets are not here:
re-enter API keys, Pushover keys, env profiles and the login password after a
restore.
`;

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Whether two manifests describe the same snapshot, whenever each was written. */
function sameContent(a: BackupManifest, b: BackupManifest): boolean {
  return JSON.stringify({ ...a, createdAt: "" }) === JSON.stringify({ ...b, createdAt: "" });
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Modification times as files keep them (whole milliseconds), so a copy's time matches its source's. */
function sameTime(a: number, b: number): boolean {
  return Math.trunc(a) === Math.trunc(b);
}

function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}
