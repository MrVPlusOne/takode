import type { MemoryCatalog, MemoryRepoOptions } from "./workstream-memory-types.js";
import {
  buildAvailableMemoryCatalogBundle,
  buildUnavailableMemoryCatalogBundle,
  renderMemoryCatalogShow,
  type MemoryCatalogInjectionBundle,
} from "./memory-catalog-injection-utils.js";

export * from "./memory-catalog-injection-utils.js";

const DEFAULT_CATALOG_TIMEOUT_MS = 3_000;
const DEFAULT_SLOW_CATALOG_SCAN_MS = 500;

type MemoryCatalogInjectionLogger = Pick<Console, "info" | "warn">;

export interface MemoryCatalogInjectionBuildOptions {
  repoOptions?: MemoryRepoOptions;
  sessionId?: string;
  limit?: number;
  timeoutMs?: number;
  slowScanThresholdMs?: number;
  catalog?: (options?: MemoryRepoOptions) => Promise<MemoryCatalog>;
  markCatalogSeen?: (catalog: MemoryCatalog, options?: MemoryRepoOptions) => Promise<void>;
  logger?: MemoryCatalogInjectionLogger;
  now?: () => number;
}

export async function buildMemoryCatalogInjectionBundle(
  options: MemoryCatalogInjectionBuildOptions = {},
): Promise<MemoryCatalogInjectionBundle> {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const slowScanThresholdMs = normalizeSlowScanThreshold(options.slowScanThresholdMs);
  const logger = options.logger ?? console;
  const now = options.now ?? (() => performance.now());
  const sessionLabel = options.sessionId || "unknown-session";
  const repoOptions = {
    ...(options.repoOptions ?? {}),
    ...(options.sessionId ? { catalogSessionKey: options.sessionId } : {}),
  };
  const catalogFn =
    options.catalog ??
    (async (input?: MemoryRepoOptions) => {
      const { workstreamMemoryService } = await import("./workstream-memory-service.js");
      return workstreamMemoryService.catalog(input, { timeoutMs });
    });
  const markSeen =
    options.markCatalogSeen ??
    (async (catalog, input) => {
      const { workstreamMemoryService } = await import("./workstream-memory-service.js");
      return workstreamMemoryService.markCatalogSeen(catalog, input);
    });

  const scanStartedAt = now();
  try {
    const catalog = await withTimeout(catalogFn(repoOptions), timeoutMs, "memory catalog scan");
    const scanMs = now() - scanStartedAt;
    if (scanMs >= slowScanThresholdMs) {
      logger.info(
        `[memory-catalog] Slow catalog scan for session ${sessionLabel}: ${Math.round(scanMs)}ms ` +
          `(entries=${catalog.entries.length}, issues=${catalog.issues.length})`,
      );
    }
    const bundle = buildAvailableMemoryCatalogBundle(renderMemoryCatalogShow(catalog), { limit: options.limit });
    return {
      ...bundle,
      recordSeen: buildCatalogSeenRecorder({
        catalog,
        repoOptions,
        markSeen,
        timeoutMs,
        slowScanThresholdMs,
        logger,
        now,
        sessionLabel,
      }),
    };
  } catch (error) {
    const scanMs = now() - scanStartedAt;
    logger.warn(
      `[memory-catalog] Catalog scan failed for session ${sessionLabel} after ${Math.round(scanMs)}ms ` +
        `(timeout=${timeoutMs}ms): ${errorMessage(error)}`,
    );
    return buildUnavailableMemoryCatalogBundle(error, { limit: options.limit });
  }
}

function buildCatalogSeenRecorder(options: {
  catalog: MemoryCatalog;
  repoOptions: MemoryRepoOptions;
  markSeen: (catalog: MemoryCatalog, options?: MemoryRepoOptions) => Promise<void>;
  timeoutMs: number;
  slowScanThresholdMs: number;
  logger: MemoryCatalogInjectionLogger;
  now: () => number;
  sessionLabel: string;
}): () => Promise<void> {
  let recordPromise: Promise<void> | undefined;
  return () => {
    if (recordPromise) return recordPromise;
    const startedAt = options.now();
    recordPromise = (async () => {
      try {
        await withTimeout(
          options.markSeen(options.catalog, options.repoOptions),
          options.timeoutMs,
          "memory catalog freshness watermark update",
        );
        const elapsedMs = options.now() - startedAt;
        if (elapsedMs >= options.slowScanThresholdMs) {
          options.logger.info(
            `[memory-catalog] Slow freshness watermark update for session ${options.sessionLabel}: ` +
              `${Math.round(elapsedMs)}ms`,
          );
        }
      } catch (error) {
        const elapsedMs = options.now() - startedAt;
        options.logger.warn(
          `[memory-catalog] Freshness watermark update failed for session ${options.sessionLabel} after ` +
            `${Math.round(elapsedMs)}ms (timeout=${options.timeoutMs}ms): ${errorMessage(error)}`,
        );
      }
    })();
    return recordPromise;
  };
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs === "number" && Number.isInteger(timeoutMs) && timeoutMs > 0) return timeoutMs;
  return DEFAULT_CATALOG_TIMEOUT_MS;
}

function normalizeSlowScanThreshold(thresholdMs: number | undefined): number {
  if (typeof thresholdMs === "number" && Number.isFinite(thresholdMs) && thresholdMs >= 0) return thresholdMs;
  return DEFAULT_SLOW_CATALOG_SCAN_MS;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
