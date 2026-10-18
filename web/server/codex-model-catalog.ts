import * as childProcess from "node:child_process";
import { machineSettingsFor } from "./remote-host/machine-settings.js";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { resolveBinary } from "./path-resolver.js";
import { getLegacyCodexHome } from "./codex-home.js";
import { buildTakodeCatalogRouteEntry, fingerprintModelRouteEntry } from "./model-identity-contract.js";
import type { CodexModelCatalog } from "./codex-session-catalog-entries.js";

const CODEX_MODEL_CATALOG_TIMEOUT_MS = 3_000;
// The account catalog may need a network fetch when Codex's own cache is stale.
const CODEX_ACCOUNT_MODEL_CATALOG_TIMEOUT_MS = 10_000;
const CODEX_MODEL_CATALOG_MAX_BUFFER = 2 * 1024 * 1024;

export interface CodexReasoningLevelInfo {
  effort: string;
  description?: string;
}

export interface CodexBackendModelInfo {
  value: string;
  canonicalIdentity: string;
  routeEntryFingerprint: string;
  label: string;
  description: string;
  supportsReasoningSummaries?: boolean;
  defaultReasoningSummary?: string;
  contextWindow?: number;
  maxContextWindow?: number;
  effectiveContextWindowPercent?: number;
  autoCompactTokenLimit?: number | null;
  serviceTiers?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  supportedReasoningLevels?: CodexReasoningLevelInfo[];
  defaultReasoningLevel?: string;
}

export interface CodexCatalogResult {
  models: CodexBackendModelInfo[];
  /**
   * `account`: the catalog the installed CLI serves for the signed-in account;
   * `installed-cli`: the catalog bundled with the CLI; `models-cache`: Codex's models_cache.json file.
   */
  source: "account" | "installed-cli" | "models-cache";
  cacheKey?: string;
  version?: string;
}

type RunCodexCommand = (
  binaryPath: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

interface LoadCodexCatalogOptions {
  codexBinary?: string;
  runCodexCommand?: RunCodexCommand;
  readFileImpl?: typeof readFile;
  statImpl?: typeof stat;
  pathExists?: (path: string) => Promise<boolean>;
  /** Ask the CLI again even when a catalog was already loaded for this binary and version. */
  refresh?: boolean;
}

let cliCatalogCache: CodexCatalogResult | null = null;
let startupRefreshPromise: Promise<CodexCatalogResult | null> | null = null;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function positivePercent(value: unknown): number | undefined {
  const numeric = positiveInteger(value);
  return numeric !== undefined && numeric <= 100 ? numeric : undefined;
}

function nullablePositiveInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return positiveInteger(value);
}

function normalizeCodexServiceTiers(
  model: Record<string, unknown>,
): Array<{ id: string; name: string; description?: string }> | undefined {
  const raw = Array.isArray(model.service_tiers)
    ? model.service_tiers
    : Array.isArray(model.serviceTiers)
      ? model.serviceTiers
      : [];
  const tiers = raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!id || !name) return null;
      const description =
        typeof item.description === "string" && item.description.trim() ? item.description : undefined;
      return { id, name, ...(description ? { description } : {}) };
    })
    .filter((entry): entry is { id: string; name: string; description?: string } => !!entry);
  return tiers.length > 0 ? tiers : undefined;
}

function normalizeReasoningLevels(value: unknown): CodexReasoningLevelInfo[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const levels = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const effort = typeof item.effort === "string" ? item.effort.trim().toLowerCase() : "";
      if (!effort) return null;
      const description =
        typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined;
      return { effort, ...(description ? { description } : {}) };
    })
    .filter((entry): entry is CodexReasoningLevelInfo => !!entry);
  return levels.length > 0 ? levels : undefined;
}

function catalogPriority(model: Record<string, unknown>): number {
  return typeof model.priority === "number" && Number.isFinite(model.priority) ? model.priority : 0;
}

export function mapCodexCatalogModels(raw: unknown): CodexBackendModelInfo[] {
  const catalog = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  // Same order as Codex's own model picker: ascending priority, catalog order on ties.
  return models
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .filter((model) => model.visibility === "list")
    .filter(
      (model): model is Record<string, unknown> & { slug: string } =>
        typeof model.slug === "string" && model.slug.trim().length > 0,
    )
    .sort((a, b) => catalogPriority(a) - catalogPriority(b))
    .map((model) => {
      const slug = (model.slug as string).trim();
      const supportedReasoningLevels = normalizeReasoningLevels(model.supported_reasoning_levels);
      const defaultReasoningLevel =
        typeof model.default_reasoning_level === "string" && model.default_reasoning_level.trim()
          ? model.default_reasoning_level.trim().toLowerCase()
          : undefined;
      return {
        value: slug,
        canonicalIdentity: slug,
        routeEntryFingerprint: fingerprintModelRouteEntry(buildTakodeCatalogRouteEntry(slug)),
        label: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : slug,
        description: typeof model.description === "string" ? model.description : "",
        supportsReasoningSummaries:
          typeof model.supports_reasoning_summaries === "boolean" ? model.supports_reasoning_summaries : undefined,
        defaultReasoningSummary:
          typeof model.default_reasoning_summary === "string" && model.default_reasoning_summary.trim()
            ? model.default_reasoning_summary.trim().toLowerCase()
            : undefined,
        contextWindow: positiveInteger(model.context_window),
        maxContextWindow: positiveInteger(model.max_context_window),
        effectiveContextWindowPercent: positivePercent(model.effective_context_window_percent),
        autoCompactTokenLimit: nullablePositiveInteger(model.auto_compact_token_limit),
        serviceTiers: normalizeCodexServiceTiers(model),
        supportedReasoningLevels,
        defaultReasoningLevel,
      };
    });
}

async function defaultRunCodexCommand(
  binaryPath: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<{ stdout: string }> {
  const execFile = (childProcess as { execFile?: typeof import("node:child_process").execFile }).execFile;
  if (!execFile) throw new Error("execFile unavailable");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(binaryPath, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
  return { stdout: String(stdout ?? "") };
}

async function getBinaryCacheKey(binaryPath: string, statImpl: typeof stat): Promise<string> {
  const binaryStat = await statImpl(binaryPath);
  return `${binaryPath}:${binaryStat.mtimeMs}:${binaryStat.size}`;
}

async function readCliCatalog(
  binaryPath: string,
  options: Pick<LoadCodexCatalogOptions, "runCodexCommand" | "statImpl" | "refresh">,
): Promise<CodexCatalogResult | null> {
  const statImpl = options.statImpl ?? stat;
  const cacheKey = await getBinaryCacheKey(binaryPath, statImpl);
  const run = options.runCodexCommand ?? defaultRunCodexCommand;
  const versionResult = await run(binaryPath, ["--version"], {
    timeout: CODEX_MODEL_CATALOG_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
  }).catch(() => ({ stdout: "" }));
  const version = versionResult.stdout.trim() || undefined;
  if (!options.refresh && cliCatalogCache?.cacheKey === cacheKey && cliCatalogCache.version === version) {
    return cliCatalogCache;
  }

  const readCatalog = async (args: string[], timeout: number) => {
    const { stdout } = await run(binaryPath, args, { timeout, maxBuffer: CODEX_MODEL_CATALOG_MAX_BUFFER });
    return mapCodexCatalogModels(JSON.parse(stdout));
  };
  // Without --bundled, Codex answers with the account's models: it reuses its own
  // models_cache.json while that is fresh for this CLI version and refetches it otherwise.
  const accountModels = await readCatalog(["debug", "models"], CODEX_ACCOUNT_MODEL_CATALOG_TIMEOUT_MS).catch(
    (error) => {
      console.warn("[codex-model-catalog] Account model catalog unavailable; using the bundled catalog:", error);
      return [];
    },
  );
  const models =
    accountModels.length > 0
      ? accountModels
      : await readCatalog(["debug", "models", "--bundled"], CODEX_MODEL_CATALOG_TIMEOUT_MS);
  if (models.length === 0) return null;

  cliCatalogCache = {
    models,
    source: accountModels.length > 0 ? "account" : "installed-cli",
    cacheKey,
    version,
  };
  return cliCatalogCache;
}

async function readModelsCacheCatalog(
  options: Pick<LoadCodexCatalogOptions, "readFileImpl" | "pathExists">,
): Promise<CodexCatalogResult | null> {
  const read = options.readFileImpl ?? readFile;
  const cachePath = join(getLegacyCodexHome(), "models_cache.json");
  if (options.pathExists && !(await options.pathExists(cachePath))) return null;
  const raw = await read(cachePath, "utf-8");
  const models = mapCodexCatalogModels(JSON.parse(raw));
  return models.length > 0 ? { models, source: "models-cache" } : null;
}

function resolveCodexBinary(override?: string): string | null {
  if (override && (override.includes("/") || override.startsWith("."))) return override;
  return resolveBinary(override || machineSettingsFor(null).codexBinary || "codex");
}

/**
 * Load the Codex models offered in Takode's pickers, in Codex's own picker order:
 * the signed-in account's catalog from the installed CLI, else the CLI's bundled
 * catalog, else ~/.codex/models_cache.json. A catalog already loaded for the same
 * binary and version is reused unless `refresh` is set.
 */
export async function loadCodexModelCatalog(options: LoadCodexCatalogOptions = {}): Promise<CodexCatalogResult | null> {
  const binaryPath = resolveCodexBinary(options.codexBinary);
  if (binaryPath) {
    try {
      const fromCli = await readCliCatalog(binaryPath, options);
      if (fromCli) return fromCli;
    } catch {
      // Fall through to the legacy Codex cache.
    }
  }

  try {
    return await readModelsCacheCatalog(options);
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Loader for the raw catalog bundled with a Codex binary (`codex debug models
 * --bundled`): full model entries, including each model's built-in prompt. It
 * is local and fast, and runs at most once per loader. Returns undefined
 * without a binary or under Vitest, so tests never run a real Codex.
 */
export function createCodexBundledModelCatalogLoader(
  codexBinary?: string,
): (() => Promise<CodexModelCatalog | null>) | undefined {
  if (!codexBinary || process.env.VITEST) return undefined;
  let loaded: Promise<CodexModelCatalog | null> | undefined;
  return () => {
    loaded ??= (async () => {
      const binaryPath = resolveCodexBinary(codexBinary);
      if (!binaryPath) return null;
      const { stdout } = await defaultRunCodexCommand(binaryPath, ["debug", "models", "--bundled"], {
        timeout: CODEX_MODEL_CATALOG_TIMEOUT_MS,
        maxBuffer: CODEX_MODEL_CATALOG_MAX_BUFFER,
      });
      const catalog = JSON.parse(stdout);
      return Array.isArray(catalog?.models) ? { models: catalog.models } : null;
    })().catch((error) => {
      console.warn("[codex-model-catalog] Bundled Codex model catalog unavailable:", error);
      return null;
    });
    return loaded;
  };
}

export function getCachedCodexModelCatalog(): CodexCatalogResult | null {
  return cliCatalogCache;
}

export function refreshCodexModelCatalogOnStartup(
  options: LoadCodexCatalogOptions = {},
): Promise<CodexCatalogResult | null> {
  if (!startupRefreshPromise) {
    startupRefreshPromise = loadCodexModelCatalog({ ...options, refresh: true }).finally(() => {
      startupRefreshPromise = null;
    });
  }
  return startupRefreshPromise;
}

export function _resetCodexModelCatalogCacheForTest(): void {
  cliCatalogCache = null;
  startupRefreshPromise = null;
}
