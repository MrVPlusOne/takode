/**
 * Copies a live session into a validation slot's HOME, and removes it again,
 * without touching anything else in that HOME. A slot's state is shared by
 * whoever holds the slot next, so every list is merged rather than replaced,
 * and a manifest remembers what each copy added so removal takes only that.
 *
 * The copy can never run a backend: its launcher entry carries no process,
 * resume ID or live token, and the session is paused.
 */
import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface SessionCopyPaths {
  /** The live sessions root, read only (~/.companion/sessions, one directory per server port). */
  liveSessionsRoot: string;
  /** The live `.companion` directory, read only; images and quests come from here. */
  liveCompanionDir: string;
  /** The slot HOME's `.companion` directory. */
  slotCompanionDir: string;
  /** The slot server's sessions directory (for example <slot HOME>/.companion/sessions/3471). */
  slotSessionsDir: string;
  /** Where the slot records the copies it holds. */
  manifestPath: string;
}

/** What one copy added to the slot, so removing it takes exactly that. */
export interface SessionCopyRecord {
  sessionId: string;
  sessionNum: number | null;
  /** File names copied into the slot's sessions directory (removal also takes files the slot server wrote since). */
  files: string[];
  /** Whether the session's image folder was copied. */
  images: boolean;
  /** Quests that were missing from the slot and added for this copy. */
  addedQuestIds: string[];
  /** Whether this copy added the session's name to the slot. */
  addedName: boolean;
  addedAt: number;
}

type LauncherEntry = Record<string, unknown> & { sessionId: string; sessionNum?: number };
type QuestStore = Record<string, unknown> & { quests: Array<Record<string, unknown> & { questId: string }> };
type SessionNames = { names: Record<string, string>; leaderCounter: number; userNamed: string[] };

/** Live launcher fields that would let the copy resume or signal the live backend. */
const LIVE_ONLY_LAUNCHER_FIELDS = [
  "pid",
  "cliSessionId",
  "hostProcId",
  "sdkDebugLogPath",
  "injectedSystemPrompt",
  "codexLeaderRecycleLineage",
  "exitCode",
  "sessionAuthToken",
];

/**
 * Copies the live session `sessionRef` (UUID, UUID prefix, `#N` or `N`) into the slot.
 * Fails if the slot already holds a session with that ID or number.
 */
export async function addSessionCopy(paths: SessionCopyPaths, sessionRef: string): Promise<SessionCopyRecord> {
  assertSeparateFromLive(paths);
  const { dir: liveSessionsDir, entry: liveEntry } = await findLiveSession(paths.liveSessionsRoot, sessionRef);
  const { sessionId } = liveEntry;

  const slotLauncher = await readJson<LauncherEntry[]>(join(paths.slotSessionsDir, "launcher.json"), []);
  if (slotLauncher.some((entry) => entry.sessionId === sessionId)) {
    throw new Error(`The slot already holds session ${sessionId}; remove it first.`);
  }
  if (
    typeof liveEntry.sessionNum === "number" &&
    slotLauncher.some((entry) => entry.sessionNum === liveEntry.sessionNum)
  ) {
    throw new Error(`The slot already has a different session numbered #${liveEntry.sessionNum}.`);
  }

  // Read the session first: it names the history chunk its saved state uses.
  const session = await readJson<Record<string, unknown> | null>(join(liveSessionsDir, `${sessionId}.json`), null);
  if (!session) throw new Error(`Session ${sessionId} has no saved state in ${liveSessionsDir}.`);
  await mkdir(paths.slotSessionsDir, { recursive: true });
  const files = (await readdir(liveSessionsDir)).filter(
    (name) => name.startsWith(`${sessionId}.`) && name !== `${sessionId}.json`,
  );
  for (const name of files) await cp(join(liveSessionsDir, name), join(paths.slotSessionsDir, name));
  const generation = (session._historyRef as { generation?: string } | undefined)?.generation;
  if (generation && !files.includes(`${sessionId}.history-${generation}.data`)) {
    await removeFiles(paths.slotSessionsDir, files);
    throw new Error("The live session saved new history while copying; run add-session again.");
  }
  await writeJsonAtomic(join(paths.slotSessionsDir, `${sessionId}.json`), pausedCopy(session));
  files.push(`${sessionId}.json`);

  const liveImages = join(paths.liveCompanionDir, "images", sessionId);
  const images = await exists(liveImages);
  if (images) await cp(liveImages, join(paths.slotCompanionDir, "images", sessionId), { recursive: true });

  const addedQuestIds = await mergeReferencedQuests(paths, session);
  const addedName = await mergeSessionName(paths, sessionId);
  await writeJsonAtomic(join(paths.slotSessionsDir, "launcher.json"), [...slotLauncher, inertLauncherEntry(liveEntry)]);

  const record: SessionCopyRecord = {
    sessionId,
    sessionNum: typeof liveEntry.sessionNum === "number" ? liveEntry.sessionNum : null,
    files,
    images,
    addedQuestIds,
    addedName,
    addedAt: Date.now(),
  };
  const manifest = await readJson<SessionCopyRecord[]>(paths.manifestPath, []);
  await writeJsonAtomic(paths.manifestPath, [...manifest, record]);
  return record;
}

/**
 * Removes copies recorded in the slot's manifest: the one named by `sessionRef`
 * (UUID, UUID prefix, `#N` or `N`), or every copy for `all`. Leaves everything
 * else in the slot untouched.
 */
export async function removeSessionCopies(paths: SessionCopyPaths, sessionRef: string): Promise<SessionCopyRecord[]> {
  assertSeparateFromLive(paths);
  const manifest = await readJson<SessionCopyRecord[]>(paths.manifestPath, []);
  const targets = sessionRef === "all" ? manifest : [resolveCopy(manifest, sessionRef)];
  const targetIds = new Set(targets.map((record) => record.sessionId));

  // The slot server rewrites a copy's history under new file names while it runs,
  // so take every file of the copied session, not only those first copied.
  const slotFiles = await readdir(paths.slotSessionsDir).catch(() => [] as string[]);
  for (const record of targets) {
    await removeFiles(
      paths.slotSessionsDir,
      slotFiles.filter((name) => name.startsWith(`${record.sessionId}.`)),
    );
    if (record.images) {
      await rm(join(paths.slotCompanionDir, "images", record.sessionId), { recursive: true, force: true });
    }
  }
  const launcherPath = join(paths.slotSessionsDir, "launcher.json");
  const launcher = await readJson<LauncherEntry[]>(launcherPath, []);
  await writeJsonAtomic(
    launcherPath,
    launcher.filter((entry) => !targetIds.has(entry.sessionId)),
  );

  // Quests stay while another remaining copy also added them.
  const keptQuestIds = new Set(
    manifest.filter((record) => !targetIds.has(record.sessionId)).flatMap((record) => record.addedQuestIds),
  );
  const questIds = new Set(
    targets.flatMap((record) => record.addedQuestIds).filter((questId) => !keptQuestIds.has(questId)),
  );
  const storePath = questStorePath(paths.slotCompanionDir);
  const store = await readJson<QuestStore | null>(storePath, null);
  if (store && questIds.size > 0) {
    await writeJsonAtomic(storePath, {
      ...store,
      quests: store.quests.filter((quest) => !questIds.has(quest.questId)),
    });
  }

  const namesPath = join(paths.slotCompanionDir, "session-names.json");
  const names = await readJson<SessionNames | null>(namesPath, null);
  const namedIds = targets.filter((record) => record.addedName).map((record) => record.sessionId);
  if (names && namedIds.length > 0) {
    for (const id of namedIds) delete names.names[id];
    names.userNamed = names.userNamed.filter((id) => !namedIds.includes(id));
    await writeJsonAtomic(namesPath, names);
  }

  await writeJsonAtomic(
    paths.manifestPath,
    manifest.filter((record) => !targetIds.has(record.sessionId)),
  );
  return targets;
}

/** Copies recorded in the slot's manifest. */
export async function listSessionCopies(paths: SessionCopyPaths): Promise<SessionCopyRecord[]> {
  return readJson<SessionCopyRecord[]>(paths.manifestPath, []);
}

/** Writes only ever go to the slot; refuse paths that would land in live state. */
function assertSeparateFromLive(paths: SessionCopyPaths): void {
  const slot = resolve(paths.slotCompanionDir);
  const live = resolve(paths.liveCompanionDir);
  if (slot === live || slot.startsWith(`${live}/`) || live.startsWith(`${slot}/`)) {
    throw new Error(`Refusing to write ${slot}: it overlaps live state at ${live}.`);
  }
}

/** The live session matching `ref`, searched in every server's sessions directory under `root`. */
async function findLiveSession(root: string, ref: string): Promise<{ dir: string; entry: LauncherEntry }> {
  const number = /^#?\d+$/.test(ref) ? Number(ref.replace("#", "")) : null;
  const matches: Array<{ dir: string; entry: LauncherEntry }> = [];
  for (const name of await readdir(root).catch(() => [] as string[])) {
    const dir = join(root, name);
    for (const entry of await readJson<LauncherEntry[]>(join(dir, "launcher.json"), [])) {
      if (number !== null ? entry.sessionNum === number : entry.sessionId.startsWith(ref)) matches.push({ dir, entry });
    }
  }
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No live session matches "${ref}" under ${root}.`);
  const where = matches.map((match) => `${match.entry.sessionId} in ${match.dir}`).join(", ");
  throw new Error(`"${ref}" matches several sessions (${where}); give a longer ID.`);
}

function resolveCopy(manifest: SessionCopyRecord[], ref: string): SessionCopyRecord {
  const number = /^#?\d+$/.test(ref) ? Number(ref.replace("#", "")) : null;
  const matches = manifest.filter((record) =>
    number !== null ? record.sessionNum === number : record.sessionId.startsWith(ref),
  );
  if (matches.length === 1) return matches[0];
  throw new Error(
    matches.length === 0
      ? `The slot holds no copy matching "${ref}" (see list-sessions).`
      : `"${ref}" matches several copies; give more.`,
  );
}

function inertLauncherEntry(live: LauncherEntry): LauncherEntry {
  const entry: LauncherEntry = { ...live };
  for (const field of LIVE_ONLY_LAUNCHER_FIELDS) delete entry[field];
  // A fresh token so the copy works in the slot; the live one must never leave live state.
  return { ...entry, state: "exited", killedByIdleManager: false, sessionAuthToken: randomUUID() };
}

function pausedCopy(session: Record<string, unknown>): Record<string, unknown> {
  const state = { ...((session.state as Record<string, unknown> | undefined) ?? {}) };
  state.backend_state = "disconnected";
  state.pause = { pausedAt: Date.now(), reason: "validation copy", queuedMessages: [] };
  return { ...session, state };
}

/** Adds the quests the session's tabs and boards name that the slot does not have yet. */
async function mergeReferencedQuests(paths: SessionCopyPaths, session: Record<string, unknown>): Promise<string[]> {
  const state = (session.state ?? {}) as { leaderOpenThreadTabs?: { orderedOpenThreadKeys?: string[] } };
  const rows = [...asRows(session.board), ...asRows(session.completedBoard)];
  const referenced = new Set([
    ...(state.leaderOpenThreadTabs?.orderedOpenThreadKeys ?? []),
    ...rows.map((row) => row.questId),
  ]);
  if (referenced.size === 0) return [];
  const live = await readJson<QuestStore | null>(questStorePath(paths.liveCompanionDir), null);
  if (!live) return [];
  const storePath = questStorePath(paths.slotCompanionDir);
  const slot = await readJson<QuestStore | null>(storePath, null);
  const present = new Set(slot?.quests.map((quest) => quest.questId));
  const added = live.quests.filter((quest) => referenced.has(quest.questId) && !present.has(quest.questId));
  if (added.length === 0) return [];
  const base: QuestStore = slot ?? { ...live, quests: [] };
  const quests = [...base.quests, ...added];
  const highest = Math.max(0, ...quests.map((quest) => Number(quest.questId.replace("q-", "")) || 0));
  const nextQuestNumber = Math.max(Number(base.nextQuestNumber) || 1, highest + 1);
  await mkdir(join(paths.slotCompanionDir, "questmaster-live"), { recursive: true });
  await writeJsonAtomic(storePath, { ...base, quests, nextQuestNumber, updatedAt: Date.now() });
  return added.map((quest) => quest.questId);
}

async function mergeSessionName(paths: SessionCopyPaths, sessionId: string): Promise<boolean> {
  const live = await readJson<SessionNames | null>(join(paths.liveCompanionDir, "session-names.json"), null);
  const name = live?.names[sessionId];
  if (!name) return false;
  const path = join(paths.slotCompanionDir, "session-names.json");
  const slot = await readJson<SessionNames>(path, { names: {}, leaderCounter: 0, userNamed: [] });
  if (slot.names[sessionId]) return false;
  slot.names[sessionId] = name;
  if (live.userNamed.includes(sessionId)) slot.userNamed = [...slot.userNamed, sessionId];
  await writeJsonAtomic(path, slot);
  return true;
}

function asRows(value: unknown): Array<{ questId: string }> {
  return Array.isArray(value) ? value.filter((row) => typeof row?.questId === "string") : [];
}

function questStorePath(companionDir: string): string {
  return join(companionDir, "questmaster-live", "store.json");
}

async function removeFiles(dir: string, names: string[]): Promise<void> {
  for (const name of names) await rm(join(dir, name), { force: true });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const text = await readFile(path, "utf-8").catch(() => null);
  return text === null ? fallback : (JSON.parse(text) as T);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}
