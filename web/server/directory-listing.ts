import { readdir, stat } from "node:fs/promises";
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
  /** Well-known starting folders of that machine, such as iCloud Drive on a Mac; only ones that exist. */
  places: { name: string; path: string }[];
}

/** macOS folders people browse from, relative to home. iCloud Drive's real folder is hard to find by hand. */
const MAC_PLACES = [
  { name: "Home", relativePath: "" },
  { name: "iCloud Drive", relativePath: "Library/Mobile Documents/com~apple~CloudDocs" },
  { name: "Desktop", relativePath: "Desktop" },
  { name: "Documents", relativePath: "Documents" },
  { name: "Downloads", relativePath: "Downloads" },
];

/**
 * List the subfolders of `path` (the home folder when absent; `~` expands) on
 * this machine, with the machine's places. Rejects when the folder cannot be read.
 */
export async function listDirectories(
  path: string | undefined,
  showHidden: boolean,
  platform: NodeJS.Platform = process.platform,
): Promise<DirectoryListing> {
  const home = homedir();
  const basePath = resolve(expandTilde(path || home));
  const [entries, places] = await Promise.all([
    readdir(basePath, { withFileTypes: true }),
    platform === "darwin" ? existingFolders(home, MAC_PLACES) : [],
  ]);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && (showHidden || !entry.name.startsWith(".")))
    .map((entry) => ({ name: entry.name, path: join(basePath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { path: basePath, dirs, home, places };
}

async function existingFolders(
  home: string,
  candidates: { name: string; relativePath: string }[],
): Promise<{ name: string; path: string }[]> {
  const found = await Promise.all(
    candidates.map(async ({ name, relativePath }) => {
      const path = join(home, relativePath);
      const info = await stat(path).catch(() => null);
      return info?.isDirectory() ? { name, path } : null;
    }),
  );
  return found.filter((place) => place !== null);
}
