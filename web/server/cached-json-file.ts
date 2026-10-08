/**
 * Reuse a parsed JSON file while it is unchanged on disk.
 *
 * The live quest store is one large JSON file (tens of MB) that every quest
 * read used to re-read and re-parse. The server is its only regular writer,
 * but the server's own Codex quest worker and tests can also replace it, so
 * every read still checks the file's identity (inode, size and nanosecond
 * mtime) and reloads when any of them changed.
 *
 * Cached values are deep-frozen: callers share one object graph, so an
 * accidental in-place edit must fail loudly instead of silently changing
 * what later reads see or what the next write persists.
 */

import { readFile, stat } from "node:fs/promises";

type Entry = { stamp: string; value: object };

const entries = new Map<string, Entry>();

/** Return the parsed file, or null when it does not exist. `parse` runs only when the file changed. */
export async function readCachedJsonFile<T extends object>(path: string, parse: (raw: string) => T): Promise<T | null> {
  const stamp = await fileStamp(path);
  if (stamp === null) {
    entries.delete(path);
    return null;
  }
  const cached = entries.get(path);
  if (cached?.stamp === stamp) return cached.value as T;
  // Stamp the file before reading it: if it is replaced in between, the newer
  // contents are cached under the older stamp and simply reloaded next time.
  const value = deepFreeze(parse(await readFile(path, "utf-8")));
  entries.set(path, { stamp, value });
  return value;
}

/** Record the value just written to `path`, so the next read skips re-parsing it. Returns the frozen value. */
export async function rememberWrittenJsonFile<T extends object>(path: string, value: T): Promise<T> {
  const stamp = await fileStamp(path);
  const frozen = deepFreeze(value);
  if (stamp === null) entries.delete(path);
  else entries.set(path, { stamp, value: frozen });
  return frozen;
}

export function _clearCachedJsonFilesForTests(): void {
  entries.clear();
}

async function fileStamp(path: string): Promise<string | null> {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Freeze an object graph. Already-frozen subtrees are skipped, so refreezing after an edit only visits new objects. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}
