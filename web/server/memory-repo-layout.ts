import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import {
  LEGACY_TYPE_FOLDERS,
  MEMORY_NOTE_TYPES,
  type MemoryCatalogEntry,
  type MemoryFolderInfo,
  type MemoryNoteType,
} from "./workstream-memory-types.js";

const execFileAsync = promisify(execFile);
const FOLDER_README = "README.md";
const HELPFUL_MARKS_FILE = "takode-memory-helpful.json";

/** Markdown files of a memory repo: notes, plus the per-folder README descriptors. */
export interface MemoryRepoFiles {
  notePaths: string[];
  readmePaths: string[];
}

/**
 * List every note and folder README under the repo, skipping dot-directories such as `.git`.
 * A `README.md` describes its folder and is never a note; root-level Markdown other than a
 * README is listed as a (misplaced) note so lint can flag it.
 */
export async function listMemoryRepoFiles(root: string): Promise<MemoryRepoFiles> {
  const files: MemoryRepoFiles = { notePaths: [], readmePaths: [] };
  await collectMarkdown(root, root, files);
  files.notePaths.sort();
  files.readmePaths.sort();
  return files;
}

export function isFolderReadme(repoRelativePath: string): boolean {
  return repoRelativePath === FOLDER_README || repoRelativePath.endsWith(`/${FOLDER_README}`);
}

export function isLegacyTypeFolder(folder: string): folder is keyof typeof LEGACY_TYPE_FOLDERS {
  return Object.hasOwn(LEGACY_TYPE_FOLDERS, folder);
}

/** An explicit valid `type:` wins; otherwise a note directly in a legacy type folder takes that folder's type. */
export function resolveNoteType(repoRelativePath: string, explicitType: string): MemoryNoteType | undefined {
  if (MEMORY_NOTE_TYPES.includes(explicitType as MemoryNoteType)) return explicitType as MemoryNoteType;
  if (explicitType) return undefined;
  const topFolder = repoRelativePath.split("/")[0];
  return isLegacyTypeFolder(topFolder) ? LEGACY_TYPE_FOLDERS[topFolder] : undefined;
}

export function noteFolder(repoRelativePath: string): string {
  const index = repoRelativePath.lastIndexOf("/");
  return index === -1 ? "" : repoRelativePath.slice(0, index);
}

export function topLevelFolder(repoRelativePath: string): string {
  return repoRelativePath.includes("/") ? repoRelativePath.split("/")[0] : "";
}

/** Local calendar date as YYYY-MM-DD, the format of `updated:` and helpful marks. */
export function localDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Last commit date per path, from one `git log` pass. Only used as the fallback for notes
 * that have no `updated:` yet (repos from before topic folders).
 */
export async function readGitLastCommitDates(root: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "-C", root, "log", "--format=@%ct", "--name-only", "--no-renames"],
      { maxBuffer: 20 * 1024 * 1024, signal },
    ));
  } catch (error) {
    if (signal?.aborted) throw error;
    return dates; // No commits yet, or not a Git repo: notes simply have no fallback date.
  }
  let date = "";
  for (const line of String(stdout).split("\n")) {
    if (line.startsWith("@")) {
      date = localDate(new Date(Number(line.slice(1)) * 1000));
    } else if (line.trim() && date && !dates.has(line.trim())) {
      dates.set(line.trim(), date);
    }
  }
  return dates;
}

/** Latest helpful-mark date per note path. Stored locally under `.git`; never committed. */
export async function readHelpfulMarks(root: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(helpfulMarksPath(root), "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export async function writeHelpfulMarks(root: string, marks: Record<string, string>): Promise<void> {
  const path = helpfulMarksPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(marks, null, 2), "utf-8");
}

/**
 * Set a top-level scalar frontmatter field, replacing an existing line or inserting it after
 * `description:`. Content without frontmatter is returned unchanged.
 */
export function setFrontmatterField(content: string, key: string, value: string): string {
  const lines = content.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return content;
  const end = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, "") === "---");
  if (end < 0) return content;
  const existing = lines.findIndex((line, index) => index > 0 && index < end && line.startsWith(`${key}:`));
  if (existing >= 0) {
    lines[existing] = `${key}: ${value}`;
    return lines.join("\n");
  }
  const description = lines.findIndex((line, index) => index > 0 && index < end && line.startsWith("description:"));
  lines.splice(description >= 0 ? description + 1 : 1, 0, `${key}: ${value}`);
  return lines.join("\n");
}

/** Later of two YYYY-MM-DD dates ("" sorts first). */
export function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * Folder summaries for every folder that holds notes or a README. A folder's version covers
 * exactly what its catalog line shows, so a dedupe handle reprints the line when it changes.
 */
export function buildMemoryFolderInfos(
  entries: MemoryCatalogEntry[],
  readmes: Map<string, { description: string }>,
): MemoryFolderInfo[] {
  const folders = new Set<string>();
  const addWithAncestors = (folder: string) => {
    const parts = folder.split("/");
    for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join("/"));
  };
  for (const entry of entries) if (entry.folder) addWithAncestors(entry.folder);
  for (const folder of readmes.keys()) if (folder) addWithAncestors(folder);

  return [...folders].sort().map((path) => {
    const prefix = `${path}/`;
    const noteCount = entries.filter((entry) => entry.path.startsWith(prefix)).length;
    const subfolders = [...folders].filter(
      (other) => other.startsWith(prefix) && !other.slice(prefix.length).includes("/"),
    );
    const description = readmes.get(path)?.description ?? "";
    const version = createHash("sha256")
      .update(JSON.stringify([description, noteCount, subfolders]))
      .digest("hex")
      .slice(0, 16);
    return { path, description, noteCount, subfolders, version };
  });
}

export function repoRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function helpfulMarksPath(root: string): string {
  return join(root, ".git", HELPFUL_MARKS_FILE);
}

async function collectMarkdown(root: string, dir: string, files: MemoryRepoFiles): Promise<void> {
  for (const entry of await safeReaddir(dir)) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(root, path, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name === FOLDER_README) files.readmePaths.push(path);
    else files.notePaths.push(path);
  }
}

async function safeReaddir(dir: string): Promise<Dirent<string>[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
