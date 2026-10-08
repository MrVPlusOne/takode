import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MEMORY_DESCRIPTION_CHAR_LIMIT,
  type MemoryCatalog,
  type MemoryCatalogEntry,
} from "./workstream-memory-types.js";

/** Size of the catalog's recent list. */
export const RECENT_NOTE_LIMIT = 50;
const HANDLE_DIR = "takode-memory-handles";
const HANDLE_PATTERN = /^mem-[0-9a-f]{10}$/;
const HANDLE_MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** Evidence records and source digests stay reachable through their folders, not the recent list. */
const RECENT_LIST_EXCLUDED_TYPES = new Set(["artifact", "reference"]);

export type MemoryCatalogViewRequest = { mode: "overview" } | { mode: "folder"; folder: string } | { mode: "all" };

export interface MemoryCatalogView {
  text: string;
  /** Handle for everything shown under the given handle plus this output; absent without a writable `.git`. */
  handle?: string;
  omitted: number;
  unknownHandle: boolean;
}

/** One output line; entries with a key/version take part in handle dedupe. */
export interface MemoryViewLine {
  text: string;
  key?: string;
  version?: string;
}

/**
 * Render a catalog view and apply handle dedupe: lines already shown under `seen` (same key and
 * version) are left out and counted, and the output ends with a handle naming the new shown set.
 * Without `seen`, the output is complete. Pass `storeHandle: false` to measure without writing.
 * `machine` says where the reader's session and the memory repo are; the overview shows it
 * under the repo line.
 */
export async function renderMemoryCatalogView(
  catalog: MemoryCatalog,
  request: MemoryCatalogViewRequest,
  options: { seen?: string; storeHandle?: boolean; machine?: string } = {},
): Promise<MemoryCatalogView> {
  const lines = buildViewLines(catalog, request);
  if (options.machine && request.mode === "overview") lines.splice(1, 0, { text: options.machine });
  return applyMemoryHandle(catalog.repo.root, lines, options);
}

/** Dedupe arbitrary view lines against a handle and issue the next one. Also used by `catalog diff`. */
export async function applyMemoryHandle(
  root: string,
  lines: MemoryViewLine[],
  options: { seen?: string; storeHandle?: boolean } = {},
): Promise<MemoryCatalogView> {
  const seenSet = options.seen ? await readHandleSet(root, options.seen) : {};
  const unknownHandle = Boolean(options.seen) && seenSet === null;
  const previous = seenSet ?? {};
  const shown: Record<string, string> = { ...previous };
  const output: string[] = [];
  let omitted = 0;
  for (const line of lines) {
    if (line.key && line.version && previous[line.key] === line.version) {
      omitted++;
      continue;
    }
    if (line.key && line.version) shown[line.key] = line.version;
    output.push(line.text);
  }

  const handle = options.storeHandle === false ? handleForSet(shown) : await storeHandleSet(root, shown);
  if (handle) output.push(formatHandleLine(handle, omitted, unknownHandle ? options.seen : undefined));
  return { text: output.join("\n"), ...(handle ? { handle } : {}), omitted, unknownHandle };
}

export function formatHandleLine(handle: string, omitted: number, unknownHandle?: string): string {
  const unknown = unknownHandle ? `unknown handle ${unknownHandle}; showing full output. ` : "";
  const omittedText = omitted ? `; ${omitted} ${omitted === 1 ? "entry" : "entries"} omitted as already shown` : "";
  return `[${unknown}memory handle: ${handle}${omittedText}. Pass --seen ${handle} to your next memory read.]`;
}

/** Recent list: `current` notes always, then the most recently touched notes, excluding evidence and references. */
export function selectRecentNotes(entries: MemoryCatalogEntry[], limit = RECENT_NOTE_LIMIT): MemoryCatalogEntry[] {
  const byTouched = [...entries].sort((a, b) => b.touched.localeCompare(a.touched) || a.path.localeCompare(b.path));
  const pinned = byTouched.filter((entry) => entry.type === "current");
  const eligible = byTouched.filter(
    (entry) => entry.type !== "current" && !RECENT_LIST_EXCLUDED_TYPES.has(entry.type ?? ""),
  );
  return [...pinned, ...eligible].slice(0, limit).sort((a, b) => a.path.localeCompare(b.path));
}

export function clipDescription(description: string): string {
  const characters = [...description];
  if (characters.length <= MEMORY_DESCRIPTION_CHAR_LIMIT) return description;
  return `${characters.slice(0, MEMORY_DESCRIPTION_CHAR_LIMIT - 1).join("")}…`;
}

/**
 * One catalog line per note: `path: description`, with a `[machines]` tag after the path when
 * the note was not written on `defaultMachine` alone (see `defaultNoteMachine`).
 */
export function noteViewLine(
  entry: MemoryCatalogEntry,
  contentHash: string | undefined,
  defaultMachine?: string,
): MemoryViewLine {
  const tag = machineTag(entry, defaultMachine);
  return {
    text: `${entry.path}${tag}: ${clipDescription(entry.description)}`,
    key: entry.path,
    // The tag depends on the repo's default machine too, so a changed tag is shown again.
    version: (contentHash ?? entry.description).slice(0, 16) + tag,
  };
}

/**
 * The machine most notes were written on alone. Catalog lines leave it out and tag only notes
 * from other (or several) machines, which keeps the catalog small. Undefined when no note is stamped.
 */
export function defaultNoteMachine(entries: MemoryCatalogEntry[]): string | undefined {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const machines = entry.machines ?? [];
    if (machines.length === 1) counts.set(machines[0], (counts.get(machines[0]) ?? 0) + 1);
  }
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))[0]?.[0];
}

/** Says which machine untagged notes come from; omitted when no note is stamped. */
export function defaultMachineLine(defaultMachine: string | undefined): MemoryViewLine[] {
  if (!defaultMachine) return [];
  return [
    {
      text: `Notes were written on machine \`${defaultMachine}\` unless tagged with other machines after the path, like \`note.md [other-machine]\`.`,
      key: "machines:default",
      version: defaultMachine,
    },
  ];
}

/** ` [machines]` for a note not written on `defaultMachine` alone, else "". */
export function machineTag(entry: MemoryCatalogEntry, defaultMachine: string | undefined): string {
  if (!defaultMachine) return "";
  const machines = entry.machines ?? [];
  if (machines.length === 1 && machines[0] === defaultMachine) return "";
  return machines.length ? ` [${machines.join(", ")}]` : " [unknown machine]";
}

function buildViewLines(catalog: MemoryCatalog, request: MemoryCatalogViewRequest): MemoryViewLine[] {
  const hashes = catalog.contentHashes ?? {};
  const defaultMachine = defaultNoteMachine(catalog.entries);
  const note = (entry: MemoryCatalogEntry) => noteViewLine(entry, hashes[entry.path], defaultMachine);
  if (request.mode === "all") {
    return [
      { text: `Memory repo: ${catalog.repo.root} (${plural(catalog.entries.length, "note")})` },
      ...defaultMachineLine(defaultMachine),
      ...catalog.entries.map(note),
    ];
  }
  if (request.mode === "folder") {
    const [folderLine, ...rest] = buildFolderLines(catalog, request.folder, note);
    return [folderLine, ...defaultMachineLine(defaultMachine), ...rest];
  }

  const recent = selectRecentNotes(catalog.entries);
  const recentPaths = new Set(recent.map((entry) => entry.path));
  const topFolders = catalog.folders.filter((folder) => !folder.path.includes("/"));
  const unfiled = catalog.entries.filter((entry) => !entry.folder);
  const lines: MemoryViewLine[] = [
    {
      text: `Memory repo: ${catalog.repo.root} (${plural(catalog.entries.length, "note")} in ${plural(topFolders.length, "top-level folder")})`,
    },
    { text: "" },
  ];
  if (!catalog.entries.length) lines.push({ text: "No memory files found." });
  lines.push(...defaultMachineLine(defaultMachine));
  if (recent.length) {
    lines.push({
      text: `Recently updated notes (${recent.length} of ${catalog.entries.length}). Before relying on memory, also list every folder that matches your task:`,
    });
    lines.push(...recent.map(note), { text: "" });
  }
  if (topFolders.length) {
    lines.push({ text: "Folders (list one with `memory catalog show <folder>`):" });
    for (const folder of topFolders) {
      const inRecent = catalog.entries.filter(
        (entry) => entry.path.startsWith(`${folder.path}/`) && recentPaths.has(entry.path),
      ).length;
      lines.push(folderViewLine(folder, inRecent));
    }
  }
  const unlisted = unfiled.filter((entry) => !recentPaths.has(entry.path));
  if (unlisted.length) lines.push({ text: "" }, { text: "Notes outside any folder:" }, ...unlisted.map(note));
  const issueCount = catalog.issues.length;
  if (issueCount) {
    lines.push(
      { text: "" },
      {
        text: `Memory health: ${issueCount} lint ${issueCount === 1 ? "issue" : "issues"}; run \`memory lint\` for details.`,
      },
    );
  }
  return lines;
}

function buildFolderLines(
  catalog: MemoryCatalog,
  folderPath: string,
  note: (entry: MemoryCatalogEntry) => MemoryViewLine,
): MemoryViewLine[] {
  const path = folderPath.replace(/^\/+|\/+$/g, "");
  const folder = catalog.folders.find((item) => item.path === path);
  if (!folder) {
    const known = catalog.folders.filter((item) => !item.path.includes("/")).map((item) => item.path);
    throw new Error(`No memory folder "${path}". Top-level folders: ${known.join(", ") || "(none)"}`);
  }
  const lines: MemoryViewLine[] = [
    {
      text: `${folder.path}/ (${plural(folder.noteCount, "note")}): ${folder.description || "(no README description)"}`,
    },
  ];
  for (const subfolder of catalog.folders.filter((item) => folder.subfolders.includes(item.path))) {
    lines.push(folderViewLine(subfolder));
  }
  lines.push(...catalog.entries.filter((entry) => entry.folder === folder.path).map(note));
  return lines;
}

function folderViewLine(folder: MemoryCatalog["folders"][number], inRecent?: number): MemoryViewLine {
  const details = [plural(folder.noteCount, "note")];
  if (inRecent !== undefined) details.push(`${inRecent} in recent list`);
  if (folder.subfolders.length) {
    details.push(`subfolders: ${folder.subfolders.map((sub) => sub.slice(folder.path.length + 1)).join(", ")}`);
  }
  const description = folder.description ? clipDescription(folder.description) : "(no README description)";
  return {
    text: `${folder.path}/ (${details.join("; ")}): ${description}`,
    key: `folder:${folder.path}`,
    version: folder.version,
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function handleForSet(set: Record<string, string>): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(set).sort(([a], [b]) => a.localeCompare(b))));
  return `mem-${createHash("sha256").update(canonical).digest("hex").slice(0, 10)}`;
}

/** Store the set once (content-addressed, immutable) and prune sets unused for 30 days. */
async function storeHandleSet(root: string, set: Record<string, string>): Promise<string | undefined> {
  const gitDir = join(root, ".git");
  try {
    await access(gitDir);
  } catch {
    return undefined; // Read-only view of an uninitialized repo: no handles.
  }
  const handle = handleForSet(set);
  const dir = join(gitDir, HANDLE_DIR);
  const path = join(dir, `${handle}.json`);
  await mkdir(dir, { recursive: true });
  try {
    await access(path);
    await touch(path);
  } catch {
    await writeFile(path, JSON.stringify(set), "utf-8");
    await pruneIdleHandleSets(dir);
  }
  return handle;
}

/** The shown set for a handle, or null when it is malformed, unknown or pruned. */
async function readHandleSet(root: string, handle: string): Promise<Record<string, string> | null> {
  if (!HANDLE_PATTERN.test(handle)) return null;
  const path = join(root, ".git", HANDLE_DIR, `${handle}.json`);
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    await touch(path);
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

async function touch(path: string): Promise<void> {
  const now = new Date();
  await utimes(path, now, now).catch(() => undefined);
}

async function pruneIdleHandleSets(dir: string): Promise<void> {
  const cutoff = Date.now() - HANDLE_MAX_IDLE_MS;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const path = join(dir, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
    } catch {
      continue; // Removed concurrently.
    }
  }
}
