import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandTilde } from "./path-resolver.js";

export interface DirectoryListing {
  /** The listed folder as an absolute path. */
  path: string;
  /** Its subfolders, sorted by name. */
  dirs: { name: string; path: string }[];
  /** The home folder of the machine that listed it. */
  home: string;
}

/**
 * List the subfolders of `path` (the home folder when absent; `~` expands) on
 * this machine. Rejects when the folder cannot be read.
 */
export async function listDirectories(path: string | undefined, showHidden: boolean): Promise<DirectoryListing> {
  const basePath = resolve(expandTilde(path || homedir()));
  const entries = await readdir(basePath, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && (showHidden || !entry.name.startsWith(".")))
    .map((entry) => ({ name: entry.name, path: join(basePath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { path: basePath, dirs, home: homedir() };
}
