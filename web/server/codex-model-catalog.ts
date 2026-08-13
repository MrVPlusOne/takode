import * as childProcess from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { resolveBinary } from "./path-resolver.js";
import { getSettings } from "./settings-manager.js";
import { getLegacyCodexHome } from "./codex-home.js";
import { buildTakodeCatalogRouteEntry, fingerprintModelRouteEntry } from "./model-identity-contract.js";

const CODEX_MODEL_CATALOG_TIMEOUT_MS = 3_000;
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
  source: "installed-cli" | "models-cache";
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
  preferInstalledCli?: boolean;
}

let installedCatalogCache: CodexCatalogResult | null = null;
let startupRefreshPromise: Promise<CodexCatalogResult | null> | null = null;

function getCodexModelVariantRank(slug: string): number {
  if (slug.includes("-codex-spark")) return 2;
  if (slug.includes("-codex")) return 0;
  return 1;
}

export function compareCodexModelSlugs(a: string, b: string): number {
  const aMatch = a.match(/^gpt-(\d+)\.(\d+)(?:\.(\d+))?/);
  const bMatch = b.match(/^gpt-(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!aMatch || !bMatch) return a.localeCompare(b);

  const aVersion = [Number(aMatch[1]), Number(aMatch[2]), Number(aMatch[3] ?? 0)];
  const bVersion = [Number(bMatch[1]), Number(bMatch[2]), Number(bMatch[3] ?? 0)];
  for (let i = 0; i < aVersion.length; i += 1) {
    if (aVersion[i] !== bVersion[i]) return bVersion[i] - aVersion[i];
  }

  const variantDelta = getCodexModelVariantRank(a) - getCodexModelVariantRank(b);
  if (variantDelta !== 0) return variantDelta;
  return a.localeCompare(b);
}

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

export function mapCodexCatalogModels(raw: unknown): CodexBackendModelInfo[] {
  const catalog = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  return models
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .filter((model) => model.visibility === "list")
    .filter(
      (model): model is Record<string, unknown> & { slug: string } =>
        typeof model.slug === "string" && model.slug.trim().length > 0,
    )
    .filter((model) => !model.slug!.startsWith("gpt-5.2") && !model.slug!.startsWith("gpt-5.1"))
    .sort((a, b) => compareCodexModelSlugs(a.slug as string, b.slug as string))
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

async function readInstalledCliCatalog(
  binaryPath: string,
  options: Pick<LoadCodexCatalogOptions, "runCodexCommand" | "statImpl">,
): Promise<CodexCatalogResult | null> {
  const statImpl = options.statImpl ?? stat;
  const cacheKey = await getBinaryCacheKey(binaryPath, statImpl);
  const run = options.runCodexCommand ?? defaultRunCodexCommand;
  const versionResult = await run(binaryPath, ["--version"], {
    timeout: CODEX_MODEL_CATALOG_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
  }).catch(() => ({ stdout: "" }));
  const version = versionResult.stdout.trim() || undefined;
  if (installedCatalogCache?.cacheKey === cacheKey && installedCatalogCache.version === version) {
    return installedCatalogCache;
  }

  const catalogResult = await run(binaryPath, ["debug", "models", "--bundled"], {
    timeout: CODEX_MODEL_CATALOG_TIMEOUT_MS,
    maxBuffer: CODEX_MODEL_CATALOG_MAX_BUFFER,
  });
  const parsed = JSON.parse(catalogResult.stdout);
  const models = mapCodexCatalogModels(parsed);
  if (models.length === 0) return null;

  installedCatalogCache = {
    models,
    source: "installed-cli",
    cacheKey,
    version,
  };
  return installedCatalogCache;
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
  return resolveBinary(override || getSettings().codexBinary || "codex");
}

export async function loadCodexModelCatalog(options: LoadCodexCatalogOptions = {}): Promise<CodexCatalogResult | null> {
  const preferInstalledCli = options.preferInstalledCli !== false;
  const binaryPath = resolveCodexBinary(options.codexBinary);
  if (preferInstalledCli && binaryPath) {
    try {
      const installed = await readInstalledCliCatalog(binaryPath, options);
      if (installed) return installed;
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

export function getCachedCodexModelCatalog(): CodexCatalogResult | null {
  return installedCatalogCache;
}

export function refreshCodexModelCatalogOnStartup(
  options: LoadCodexCatalogOptions = {},
): Promise<CodexCatalogResult | null> {
  if (!startupRefreshPromise) {
    startupRefreshPromise = loadCodexModelCatalog({ ...options, preferInstalledCli: true }).finally(() => {
      startupRefreshPromise = null;
    });
  }
  return startupRefreshPromise;
}

export function _resetCodexModelCatalogCacheForTest(): void {
  installedCatalogCache = null;
  startupRefreshPromise = null;
}
