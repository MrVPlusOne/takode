import { mkdir, readdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stampNoteMachine } from "./memory-note-machines.js";
import { assertActiveMemoryLock, ensureMemoryRepo, resolveMemoryRepo } from "./workstream-memory-store.js";
import type { MemoryRepoOptions } from "./workstream-memory-types.js";

/**
 * Note-level reads and writes behind `memory read`, `grep`, `write` and `rm`.
 * Agents use these commands instead of opening the repo with their own file
 * tools, so memory works the same from machines that have no copy of the repo:
 * the server that owns the repo runs them.
 */

export interface MemoryNoteText {
  path: string;
  content: string;
}

export interface MemoryGrepResult {
  /** `path:line:text` for each matching line, in repo path order. */
  lines: string[];
  /** Matching lines left out after `limit`. */
  omitted: number;
}

/** The full text of each note, in the order asked. */
export async function readMemoryNotes(paths: string[], options: MemoryRepoOptions): Promise<MemoryNoteText[]> {
  const root = await realpath(resolveMemoryRepo(options).root);
  const notes: MemoryNoteText[] = [];
  for (const path of paths) {
    const absolute = await existingNotePath(root, path);
    notes.push({ path: cleanNotePath(path), content: await readFile(absolute, "utf-8") });
  }
  return notes;
}

/**
 * Lines matching a JavaScript regular expression in the repo's Markdown files,
 * optionally only under the given repo-relative folders or notes. Hidden
 * directories (including `.git`) are skipped.
 */
export async function grepMemoryNotes(
  pattern: string,
  search: { paths?: string[]; ignoreCase?: boolean; limit: number },
  options: MemoryRepoOptions,
): Promise<MemoryGrepResult> {
  let re: RegExp;
  try {
    re = new RegExp(pattern, search.ignoreCase ? "i" : "");
  } catch (error) {
    throw new Error(`Invalid pattern: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = await realpath(resolveMemoryRepo(options).root);
  const scopes = (search.paths ?? []).map((path) => syntacticRelativePath(root, path, { allowFolder: true }));
  const files = (await markdownFiles(root)).filter(
    (file) => !scopes.length || scopes.some((scope) => file === scope || file.startsWith(`${scope}/`)),
  );
  const lines: string[] = [];
  let omitted = 0;
  for (const file of files) {
    const content = await readFile(join(root, file), "utf-8");
    content.split("\n").forEach((text, index) => {
      if (!re.test(text)) return;
      if (lines.length < search.limit) lines.push(`${file}:${index + 1}:${text}`);
      else omitted += 1;
    });
  }
  return { lines, omitted };
}

/**
 * Create or replace one note (or folder README) with `content`. Requires the repo lock.
 * A note gets `machine` (the writing session's) added to its `machines:` list.
 */
export async function writeMemoryNote(
  path: string,
  content: string,
  options: MemoryRepoOptions,
  machine?: string,
): Promise<string> {
  const repo = await ensureMemoryRepo(options);
  await assertActiveMemoryLock(repo.root);
  const root = await realpath(repo.root);
  const relativePath = syntacticRelativePath(root, path);
  const absolute = join(root, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  // A symlinked folder or file must not lead the write outside the repo.
  assertInside(root, await realpath(dirname(absolute)));
  const existing = await realpath(absolute).then(
    (target) => (assertInside(root, target), true),
    () => false,
  );
  let text = content.endsWith("\n") ? content : `${content}\n`;
  if (machine && basename(relativePath) !== "README.md") {
    text = stampNoteMachine(text, machine, existing ? await readFile(absolute, "utf-8") : undefined);
  }
  await writeFile(absolute, text, "utf-8");
  return relativePath;
}

/** Delete one note, and its folder when that leaves it empty. Requires the repo lock. */
export async function removeMemoryNote(path: string, options: MemoryRepoOptions): Promise<string> {
  const repo = await ensureMemoryRepo(options);
  await assertActiveMemoryLock(repo.root);
  const root = await realpath(repo.root);
  const absolute = await existingNotePath(root, path);
  await unlink(absolute);
  const folder = dirname(absolute);
  if (folder !== root && (await readdir(folder)).length === 0) await rmdir(folder);
  return relative(root, absolute).split(sep).join("/");
}

async function existingNotePath(root: string, path: string): Promise<string> {
  const absolute = join(root, syntacticRelativePath(root, path));
  const target = await realpath(absolute).catch(() => {
    throw new Error(`Not a memory note: ${cleanNotePath(path)}`);
  });
  assertInside(root, target);
  return target;
}

/** A repo-relative path to a Markdown file (or a folder), refusing escapes and hidden directories. */
function syntacticRelativePath(root: string, path: string, opts: { allowFolder?: boolean } = {}): string {
  const cleaned = cleanNotePath(path);
  if (!cleaned) throw new Error("A repo-relative memory path is required");
  if (isAbsolute(path.trim())) throw new Error(`Memory paths are repo-relative: ${path}`);
  const relativePath = relative(root, resolve(root, cleaned)).split(sep).join("/");
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Memory paths must stay inside the memory repo: ${path}`);
  }
  if (relativePath.split("/").some((segment) => segment.startsWith("."))) {
    throw new Error(`Memory paths must not be inside a hidden directory: ${path}`);
  }
  if (!opts.allowFolder && !relativePath.endsWith(".md")) throw new Error(`Memory notes are Markdown files: ${path}`);
  return relativePath;
}

function assertInside(root: string, target: string): void {
  const relativePath = relative(root, target);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Memory paths must stay inside the memory repo");
  }
}

function cleanNotePath(path: string): string {
  return path
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

async function markdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries
    .map((entry) => entry.split(sep).join("/"))
    .filter((entry) => entry.endsWith(".md") && !entry.split("/").some((segment) => segment.startsWith(".")))
    .sort();
}
