import { mkdir, readdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { readHelpfulMarks, setFrontmatterField, writeHelpfulMarks } from "./memory-repo-layout.js";
import { assertActiveMemoryLock, ensureMemoryRepo, scanMemoryCatalog } from "./workstream-memory-store.js";
import type { MemoryRepoOptions } from "./workstream-memory-types.js";

const MARKDOWN_LINK_TARGET = /\]\(([^)\s]+)\)/g;

export interface MemoryMove {
  from: string;
  to: string;
}

export interface MemoryMoveResult {
  moved: number;
  /** Other notes whose references were rewritten. */
  rewrittenNotes: number;
}

/**
 * Move notes and keep every reference to them working. Under the repo lock, for each moved note:
 * creates the destination folder, rewrites references in all notes (Markdown links, absolute
 * paths under the repo, and plain or inline-code repo-relative mentions), fills in a missing
 * `type:` and `updated:` so the move neither loses a legacy note's type nor its recency, moves
 * its helpful mark, and renames it. Commit the result with `memory commit --operation repair`.
 */
export async function moveMemoryNotes(options: MemoryRepoOptions, moves: MemoryMove[]): Promise<MemoryMoveResult> {
  const repo = await ensureMemoryRepo(options);
  await assertActiveMemoryLock(repo.root);
  const catalog = await scanMemoryCatalog(options);
  const entries = new Map(catalog.entries.map((entry) => [entry.path, entry]));
  const table = validateMoves(moves, entries, repo.root);
  const notePaths = new Set(entries.keys());

  let rewrittenNotes = 0;
  for (const entry of catalog.entries) {
    const absolute = join(repo.root, entry.path);
    const original = await readFile(absolute, "utf-8");
    const newPath = table.get(entry.path) ?? entry.path;
    let content = rewriteMemoryReferences(original, entry.path, newPath, table, repo.root, notePaths);
    if (table.has(entry.path)) {
      if (entry.type && !hasField(content, "type")) content = setFrontmatterField(content, "type", entry.type);
      if (entry.updated && !hasField(content, "updated"))
        content = setFrontmatterField(content, "updated", entry.updated);
    } else if (content !== original) {
      rewrittenNotes++;
    }
    if (content !== original) await writeFile(absolute, content, "utf-8");
  }

  // Plain renames: Git records moves by content similarity at commit time, so `git mv` adds nothing.
  for (const [from, to] of table) {
    await mkdir(dirname(join(repo.root, to)), { recursive: true });
    await rename(join(repo.root, from), join(repo.root, to));
  }
  await moveHelpfulMarks(repo.root, table);
  await removeEmptyFolders(
    repo.root,
    [...table.keys()].map((from) => dirname(from)),
  );
  return { moved: table.size, rewrittenNotes };
}

/**
 * Rewrite references from one note (old path `notePath`, new path `newNotePath`) to moved notes.
 * Note-relative links are recomputed from the note's new folder; repo-root-relative, absolute and
 * plain-text mentions keep their style. `notePaths` lists every existing note (old paths).
 */
export function rewriteMemoryReferences(
  content: string,
  notePath: string,
  newNotePath: string,
  table: ReadonlyMap<string, string>,
  root: string,
  notePaths: ReadonlySet<string>,
): string {
  const rootPrefix = `${root.replace(/\/+$/, "")}/`;
  const noteMoved = table.has(notePath);

  let result = content.replace(MARKDOWN_LINK_TARGET, (whole, rawTarget: string) => {
    const suffixMatch = /\.md((?::[\d:-]+|#.*)?)$/.exec(rawTarget);
    if (!suffixMatch) return whole;
    const suffix = suffixMatch[1];
    const target = rawTarget.slice(0, rawTarget.length - suffix.length);
    if (target.startsWith("file:") || target.includes(":") || isAbsolute(target)) return whole; // Absolute: below.
    const fromNote = normalize(join(dirname(notePath), target));
    if (!fromNote.startsWith("..") && notePaths.has(fromNote)) {
      if (!noteMoved && !table.has(fromNote)) return whole;
      const destination = table.get(fromNote) ?? fromNote;
      return `](${relative(dirname(newNotePath), destination)}${suffix})`;
    }
    const rootTarget = table.get(normalize(target));
    return rootTarget ? `](${rootTarget}${suffix})` : whole;
  });

  if (!table.size) return result;
  const alternatives = [...table.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  result = result.replace(new RegExp(`${escapeRegExp(rootPrefix)}(${alternatives})`, "g"), (_, from: string) => {
    return `${rootPrefix}${table.get(from)}`;
  });
  return result.replace(new RegExp(`(?<![\\w./-])(${alternatives})(?![\\w-])`, "g"), (_, from: string) => {
    return table.get(from) ?? from;
  });
}

function validateMoves(moves: MemoryMove[], entries: ReadonlyMap<string, unknown>, root: string): Map<string, string> {
  const table = new Map<string, string>();
  const destinations = new Set<string>();
  for (const move of moves) {
    const from = cleanPath(move.from);
    const to = cleanPath(move.to);
    if (!entries.has(from)) throw new Error(`Not a memory note: ${from}`);
    if (!to.endsWith(".md") || !to.includes("/") || to.endsWith("/README.md"))
      throw new Error(`Destination must be <folder>/<name>.md (not a folder README): ${to}`);
    if (to.split("/").some((segment) => !segment || segment.startsWith(".") || segment === ".."))
      throw new Error(`Destination must stay inside the memory repo, outside hidden folders: ${to}`);
    if (normalize(join(root, to)) !== join(root, to))
      throw new Error(`Destination must be a plain repo-relative path: ${to}`);
    if (table.has(from)) throw new Error(`Note listed twice: ${from}`);
    if (destinations.has(to)) throw new Error(`Two notes moved to ${to}`);
    if (from !== to) {
      table.set(from, to);
      destinations.add(to);
    }
  }
  // Chains and swaps (moving onto a note that is itself moving) are rejected for simplicity.
  for (const to of destinations) {
    if (entries.has(to)) throw new Error(`Destination already exists: ${to}`);
  }
  return table;
}

/** Parse a move plan: one "old new" pair per line; blank lines and # comments are ignored. */
export function parseMovePlan(text: string): MemoryMove[] {
  const moves: MemoryMove[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 2) throw new Error(`Move plan line ${index + 1} must be "<old-path> <new-path>": ${line}`);
    moves.push({ from: parts[0], to: parts[1] });
  }
  return moves;
}

function cleanPath(path: string): string {
  return path
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

function hasField(content: string, key: string): boolean {
  const end = content.indexOf("\n---", 3);
  return new RegExp(`^${key}:`, "m").test(end === -1 ? "" : content.slice(0, end));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function moveHelpfulMarks(root: string, table: ReadonlyMap<string, string>): Promise<void> {
  const marks = await readHelpfulMarks(root);
  let changed = false;
  for (const [from, to] of table) {
    if (!marks[from]) continue;
    marks[to] = marks[from];
    delete marks[from];
    changed = true;
  }
  if (changed) await writeHelpfulMarks(root, marks);
}

async function removeEmptyFolders(root: string, folders: string[]): Promise<void> {
  for (const folder of [...new Set(folders)].sort((a, b) => b.length - a.length)) {
    if (!folder || folder === ".") continue;
    const path = join(root, folder);
    if ((await readdir(path).catch(() => ["(missing)"])).length === 0) await rmdir(path).catch(() => undefined);
  }
}
