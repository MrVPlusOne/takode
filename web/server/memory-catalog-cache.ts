import { resolveMemoryRepo, scanMemoryCatalog, type MemoryCatalogScanRuntime } from "./workstream-memory-store.js";
import type { MemoryCatalog, MemoryRepoOptions } from "./workstream-memory-types.js";

/**
 * Catalogs kept between scans for the catalog injected at session start and after compaction. A scan reads
 * every note through dozens of awaits, so on a busy server it missed its deadline and sessions started
 * without a catalog. The server makes every memory write itself and drops kept catalogs when it does
 * (`forgetKeptMemoryCatalogs`); notes changed outside the server appear after a background refresh.
 */
const REFRESH_AFTER_MS = 60_000;

interface KeptCatalog {
  catalog: MemoryCatalog;
  /** The write generation the scan started in; a later memory write makes the catalog stale. */
  generation: number;
  scannedAt: number;
}

const kept = new Map<string, KeptCatalog>();
const refreshing = new Set<string>();
let generation = 0;

/** A memory write happened (or may have): kept catalogs no longer describe the repo. */
export function forgetKeptMemoryCatalogs(): void {
  generation++;
}

/**
 * The repo's catalog, from the last scan unless a memory write made it stale. A catalog older than a minute
 * is still returned and refreshed in the background. When a needed scan fails or times out, a stale catalog
 * is returned if there is one.
 */
export async function keptMemoryCatalog(
  options: MemoryRepoOptions = {},
  runtime: MemoryCatalogScanRuntime = {},
  now: () => number = Date.now,
): Promise<MemoryCatalog> {
  const key = resolveMemoryRepo(options).root;
  const entry = kept.get(key);
  if (entry?.generation === generation) {
    if (now() - entry.scannedAt >= REFRESH_AFTER_MS && !refreshing.has(key)) {
      refreshing.add(key);
      scanAndKeep(key, options, {}, now)
        .catch((error) => console.warn(`[memory-catalog] Background catalog refresh failed for ${key}:`, error))
        .finally(() => refreshing.delete(key));
    }
    return entry.catalog;
  }
  try {
    return await scanAndKeep(key, options, runtime, now);
  } catch (error) {
    if (entry) return entry.catalog;
    throw error;
  }
}

async function scanAndKeep(
  key: string,
  options: MemoryRepoOptions,
  runtime: MemoryCatalogScanRuntime,
  now: () => number,
): Promise<MemoryCatalog> {
  const started = generation;
  const catalog = await scanMemoryCatalog(options, runtime);
  const current = kept.get(key);
  // Never replace a catalog from a newer write generation with one that started before it.
  if (!current || current.generation <= started) kept.set(key, { catalog, generation: started, scannedAt: now() });
  return catalog;
}
