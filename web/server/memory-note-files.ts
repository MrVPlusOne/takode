import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stampNoteMachine } from "./memory-note-machines.js";
import { setFrontmatterField } from "./memory-repo-layout.js";
import { assertMemoryLockHolder, ensureMemoryRepo, resolveMemoryRepo } from "./workstream-memory-store.js";
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

/** The full text of each note, in the order asked. The reading session may then replace them. */
export async function readMemoryNotes(paths: string[], options: MemoryRepoOptions): Promise<MemoryNoteText[]> {
  const root = await realpath(resolveMemoryRepo(options).root);
  const notes: MemoryNoteText[] = [];
  for (const path of paths) {
    const absolute = await existingNotePath(root, path);
    const content = await readFile(absolute, "utf-8");
    rememberSeenVersion(seenKey(root, options, syntacticRelativePath(root, path)), content);
    notes.push({ path: cleanNotePath(path), content });
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
 * Replacing a note needs the session to have read (or written) its current version, so a
 * save never silently undoes another session's newer edit.
 */
export async function writeMemoryNote(
  path: string,
  content: string,
  options: MemoryRepoOptions,
  machine?: string,
): Promise<string> {
  const repo = await ensureMemoryRepo(options);
  await assertMemoryLockHolder(repo.root, options.lockHolder);
  const root = await realpath(repo.root);
  const relativePath = syntacticRelativePath(root, path);
  const absolute = join(root, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  // A symlinked folder or file must not lead the write outside the repo.
  assertInside(root, await realpath(dirname(absolute)));
  const previous = await realpath(absolute).then(
    (target) => (assertInside(root, target), readFile(target, "utf-8")),
    () => undefined,
  );
  const key = seenKey(root, options, relativePath);
  assertSeenCurrentVersion(key, relativePath, previous);
  let text = content.endsWith("\n") ? content : `${content}\n`;
  if (machine && basename(relativePath) !== "README.md") {
    text = stampNoteMachine(text, machine, previous);
  }
  await writeFile(absolute, text, "utf-8");
  rememberSeenVersion(key, text);
  return relativePath;
}

/** Delete one note, and its folder when that leaves it empty. Requires the repo lock. */
export async function removeMemoryNote(path: string, options: MemoryRepoOptions): Promise<string> {
  const repo = await ensureMemoryRepo(options);
  await assertMemoryLockHolder(repo.root, options.lockHolder);
  const root = await realpath(repo.root);
  const absolute = await existingNotePath(root, path);
  await unlink(absolute);
  seenVersions.delete(seenKey(root, options, syntacticRelativePath(root, path)));
  const folder = dirname(absolute);
  if (folder !== root && (await readdir(folder)).length === 0) await rmdir(folder);
  return relative(root, absolute).split(sep).join("/");
}

/**
 * The version of each note that each session last read or wrote, by repo, session and path.
 * Kept in the server's memory only: after a restart, replacing a note asks for a fresh read.
 */
const seenVersions = new Map<string, string>();
const SEEN_VERSIONS_LIMIT = 20_000;

function seenKey(root: string, options: MemoryRepoOptions, relativePath: string): string {
  return JSON.stringify([root, options.lockHolder ?? "", relativePath]);
}

function rememberSeenVersion(key: string, content: string): void {
  seenVersions.delete(key); // Re-insert so the oldest entries are dropped first.
  seenVersions.set(key, noteVersion(content));
  if (seenVersions.size > SEEN_VERSIONS_LIMIT) seenVersions.delete(seenVersions.keys().next().value!);
}

/** `previous` is the note's current text, undefined when there is no note at the path. */
function assertSeenCurrentVersion(key: string, path: string, previous: string | undefined): void {
  const seen = seenVersions.get(key);
  const retry = `Run \`memory read ${path}\`, merge your edits into its current text, and write again.`;
  if (previous === undefined) {
    if (seen === undefined) return;
    // Forget it, so a deliberate second write can recreate the note.
    seenVersions.delete(key);
    throw new Error(
      `Not saved: ${path} was removed or moved since this session read it. ` +
        "Check `memory catalog diff`; write again only if the note should still exist here.",
    );
  }
  if (seen === undefined) throw new Error(`Not saved: ${path} exists and this session has not read it. ${retry}`);
  if (seen !== noteVersion(previous)) {
    throw new Error(`Not saved: ${path} changed since this session last read it, and saving would undo that. ${retry}`);
  }
}

/**
 * Content hash ignoring `updated:` and `machines:`, which commits re-stamp on the notes they
 * change: a session's own commit must not make its next write of the same note look stale.
 */
function noteVersion(content: string): string {
  const authored = setFrontmatterField(setFrontmatterField(content, "updated", ""), "machines", "");
  return createHash("sha256").update(authored).digest("hex");
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
