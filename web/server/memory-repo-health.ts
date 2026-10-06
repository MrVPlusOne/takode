import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, normalize } from "node:path";
import { renderMemoryCatalogView } from "./memory-catalog-view.js";
import { isLegacyTypeFolder, localDate } from "./memory-repo-layout.js";
import type { MemoryCatalog, MemoryLintIssue } from "./workstream-memory-types.js";

export const FOLDER_MIN_ENTRIES = 5;
export const FOLDER_MAX_ENTRIES = 25;
/** Lint warns past ~12k tokens (4 characters per token) so the catalog stays under its ~16k-token target. */
export const CATALOG_WARN_CHARS = 48_000;
const CURRENT_STALE_DAYS = 30;
const ROUTING_PREFIX = /^Read (when|before|for)\b/;
const PLAIN_PATH_MENTION = /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]+\.md)(?![\w-])/g;
const MARKDOWN_LINK_TARGET = /\]\(([^)\s]+)\)/g;

/**
 * Repo-wide structure checks that complement per-note schema validation: duplicate names,
 * routing descriptions, folder sizes and READMEs, legacy folders, stale `current` notes,
 * broken links or stale path mentions, and catalog size. Everything is a warning except
 * duplicate names, which block commits of the duplicated notes.
 */
export async function checkMemoryRepoHealth(catalog: MemoryCatalog): Promise<MemoryLintIssue[]> {
  const issues: MemoryLintIssue[] = [];
  const notePaths = new Set(catalog.entries.map((entry) => entry.path));
  const folderPaths = new Set(catalog.folders.map((folder) => folder.path));

  const byName = new Map<string, string[]>();
  for (const entry of catalog.entries)
    byName.set(basename(entry.path), [...(byName.get(basename(entry.path)) ?? []), entry.path]);
  for (const paths of byName.values()) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      issues.push({
        severity: "warning",
        blocksCommitOfNote: true,
        path,
        message: `File name is not unique (${paths.join(", ")}); rename one so moved notes stay findable by name.`,
      });
    }
  }

  const today = localDate();
  for (const entry of catalog.entries) {
    if (entry.description && !ROUTING_PREFIX.test(entry.description)) {
      issues.push({
        severity: "warning",
        path: entry.path,
        message: 'Description should be a routing line starting "Read when", "Read before" or "Read for".',
      });
    }
    if (entry.type === "current" && entry.updated && daysBetween(entry.updated, today) > CURRENT_STALE_DAYS) {
      issues.push({
        severity: "warning",
        path: entry.path,
        message: `Current note last updated ${entry.updated}; refresh it or remove it if the state no longer applies.`,
      });
    }
  }

  for (const folder of catalog.folders) {
    if (isLegacyTypeFolder(folder.path)) {
      issues.push({
        severity: "warning",
        path: `${folder.path}/`,
        message:
          "Legacy type folder; move its notes into topic folders (see the curation procedure in the memory skill).",
      });
      continue;
    }
    const entries = catalog.entries.filter((entry) => entry.folder === folder.path).length + folder.subfolders.length;
    if (entries < FOLDER_MIN_ENTRIES || entries > FOLDER_MAX_ENTRIES) {
      issues.push({
        severity: "warning",
        path: `${folder.path}/`,
        message: `Folder has ${entries} ${entries === 1 ? "entry" : "entries"}; keep ${FOLDER_MIN_ENTRIES}-${FOLDER_MAX_ENTRIES} (${entries < FOLDER_MIN_ENTRIES ? "merge it into a related folder" : "split it by subject"}).`,
      });
    }
    if (!folder.description) {
      issues.push({
        severity: "warning",
        path: `${folder.path}/`,
        message: 'Folder has no README.md description ("Read for <subject>: <main subtopics>").',
      });
    }
  }

  const root = catalog.repo.root;
  for (const entry of catalog.entries) {
    let content: string;
    try {
      content = await readFile(join(root, entry.path), "utf-8");
    } catch {
      continue;
    }
    for (const target of staleMemoryReferences(content, entry.folder, root, notePaths, folderPaths)) {
      issues.push({
        severity: "warning",
        path: entry.path,
        message: `Reference to missing memory note ${target}; point it at the note's current path.`,
      });
    }
  }

  const overview = await renderMemoryCatalogView(catalog, { mode: "overview" }, { storeHandle: false });
  if (overview.text.length > CATALOG_WARN_CHARS) {
    issues.push({
      severity: "warning",
      message: `Catalog is ${overview.text.length.toLocaleString()} characters, past the ~${CATALOG_WARN_CHARS.toLocaleString()}-character warning; merge small folders, then group related folders (see the memory skill).`,
    });
  }
  return issues;
}

/** Catalog size line for `memory lint`. */
export async function memoryHealthSummary(catalog: MemoryCatalog): Promise<string> {
  const overview = await renderMemoryCatalogView(catalog, { mode: "overview" }, { storeHandle: false });
  const topFolders = catalog.folders.filter((folder) => !folder.path.includes("/")).length;
  const tokens = Math.round(overview.text.length / 4);
  return `${catalog.entries.length} notes, ${topFolders} top-level folders, catalog ${overview.text.length.toLocaleString()} characters (~${tokens.toLocaleString()} tokens; target under ~16,000).`;
}

/**
 * Memory paths a note refers to that no longer exist: Markdown link targets resolving inside the
 * repo, absolute paths under the repo root, and plain repo-relative mentions whose first segment
 * is a memory folder. Project-repo `file:` links (relative) are not memory references.
 */
export function staleMemoryReferences(
  content: string,
  noteFolder: string,
  root: string,
  notePaths: ReadonlySet<string>,
  folderPaths: ReadonlySet<string>,
): string[] {
  const missing = new Set<string>();
  const exists = (path: string) => notePaths.has(path) || path === "README.md" || path.endsWith("/README.md");
  const rootPrefix = `${root.replace(/\/+$/, "")}/`;

  const memoryFolders = new Set([...folderPaths].map((path) => path.split("/")[0]));
  const isMemoryPath = (path: string) => {
    const first = path.split("/")[0];
    return memoryFolders.has(first) || isLegacyTypeFolder(first);
  };

  for (const match of content.matchAll(MARKDOWN_LINK_TARGET)) {
    const target = stripLinkSuffix(match[1]);
    if (!target.endsWith(".md")) continue;
    let resolved: string | undefined;
    if (target.startsWith(`file:${rootPrefix}`)) resolved = target.slice(`file:${rootPrefix}`.length);
    else if (target.startsWith(rootPrefix)) resolved = target.slice(rootPrefix.length);
    else if (!target.startsWith("file:") && !target.includes(":") && !isAbsolute(target)) {
      // Note-relative first; repo-root-relative mentions are a common older style.
      const fromNote = normalize(join(noteFolder || ".", target));
      const fromRoot = normalize(target);
      if (exists(fromNote) || exists(fromRoot)) continue;
      if (!fromNote.startsWith("..") && (folderPaths.has(dirnameOf(fromNote)) || isMemoryPath(fromNote))) {
        resolved = fromNote;
      } else if (isMemoryPath(fromRoot)) resolved = fromRoot;
    }
    if (resolved && !exists(resolved)) missing.add(resolved);
  }

  // A plain mention is only treated as stale when a note with that file name exists elsewhere
  // (it was moved); other paths, such as files inside skills, are not memory references.
  const noteNames = new Set([...notePaths].map((path) => path.slice(path.lastIndexOf("/") + 1)));
  for (const match of content.matchAll(PLAIN_PATH_MENTION)) {
    const path = match[1];
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (isMemoryPath(path) && !exists(path) && noteNames.has(name)) missing.add(path);
  }
  for (const match of content.matchAll(new RegExp(`${escapeRegExp(rootPrefix)}([\\w./-]+\\.md)`, "g"))) {
    if (!exists(match[1])) missing.add(match[1]);
  }
  return [...missing].sort();
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function stripLinkSuffix(target: string): string {
  return target.replace(/(\.md)(?::[\d:-]+|#.*)$/, "$1");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000;
}
