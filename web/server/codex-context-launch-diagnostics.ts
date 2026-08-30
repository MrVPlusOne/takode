import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readTopLevelNumberSetting, readTopLevelStringSetting } from "./cli-launcher-codex-config-utils.js";
import { createLogger } from "./server-logger.js";
import type { CodexAutoCompactTokenLimitScope, CodexContextWindowDiagnostics } from "./codex-context-types.js";
import type { CodexLeaderCompactionMode } from "../shared/codex-leader-compaction-mode.js";
import { CODEX_LEADER_RECYCLE_FALLBACK_THRESHOLD_TOKENS } from "./codex-leader-recycle-threshold.js";

export const CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
export const CODEX_DEFAULT_AUTO_COMPACT_TOKEN_LIMIT_SCOPE: CodexAutoCompactTokenLimitScope = "total";
const CODEX_DEFAULT_AUTO_COMPACT_PERCENT = 90;
const CODEX_LEADER_PROVIDER_ENVELOPE_MULTIPLIER = 5;
const contextLog = createLogger("cli-launcher/codex-context");

export interface CodexResolvedContextLaunchConfig {
  modelContextWindow: number;
  modelAutoCompactTokenLimit: number;
  catalogEffectiveContextWindowPercent: number;
  modelCatalogConfigPath?: string;
}

export interface CodexLeaderLaunchGuard {
  displayContextWindow: number;
  providerRawContextWindow: number;
  providerAutoCompactTokenLimit: number;
  catalogEffectiveContextWindowPercent: number;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveConfigPathValue(configDir: string, rawPath: string): string {
  if (rawPath.startsWith("~/")) return join(homedir(), rawPath.slice(2));
  return resolve(configDir, rawPath);
}

function parseCatalogEntry(
  catalogJson: string | undefined,
  model: string | undefined,
): Record<string, unknown> | undefined {
  if (!catalogJson || !model) return undefined;
  try {
    const catalog = JSON.parse(catalogJson) as { models?: Array<Record<string, unknown>> };
    return catalog.models?.find((entry) => entry.slug === model);
  } catch {
    return undefined;
  }
}

async function readConfiguredCatalogEntry(
  codexHome: string,
  configToml: string,
  model: string | undefined,
  generatedCatalogJson: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  const generatedEntry = parseCatalogEntry(generatedCatalogJson, model);
  if (generatedEntry) return generatedEntry;
  const rawPath = readTopLevelStringSetting(configToml, "model_catalog_json");
  if (!rawPath || !model) return undefined;
  try {
    return parseCatalogEntry(await readFile(resolveConfigPathValue(codexHome, rawPath), "utf-8"), model);
  } catch {
    return undefined;
  }
}

function configuredCatalogIsTakodeOwned(configToml: string): boolean {
  const rawPath = readTopLevelStringSetting(configToml, "model_catalog_json");
  if (!rawPath) return false;
  const filename = basename(rawPath);
  return filename === "takode-model-catalog.json" || filename === "takode-leader-model-catalog.json";
}

export function effectiveContextWindowFromModelEntry(modelEntry: Record<string, unknown>): number | undefined {
  const rawContextWindow = positiveNumber(modelEntry.context_window) || positiveNumber(modelEntry.max_context_window);
  if (!rawContextWindow) return undefined;
  const effectivePercent =
    positiveNumber(modelEntry.effective_context_window_percent) || CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
  return Math.max(1, Math.floor((rawContextWindow * effectivePercent) / 100));
}

export function nonLeaderAutoCompactTokenLimitForUsableCapacity(usableContextWindow: number): number {
  return Math.max(1, Math.floor((usableContextWindow * CODEX_DEFAULT_AUTO_COMPACT_PERCENT) / 100));
}

export function deriveCodexLeaderLaunchGuard(
  recycleThresholdTokens: number,
  effectiveContextWindowPercent = CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
): CodexLeaderLaunchGuard {
  const displayContextWindow = positiveNumber(recycleThresholdTokens) ?? CODEX_LEADER_RECYCLE_FALLBACK_THRESHOLD_TOKENS;
  const effectivePercent =
    positiveNumber(effectiveContextWindowPercent) ?? CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
  const providerAutoCompactTokenLimit = Math.ceil(displayContextWindow * CODEX_LEADER_PROVIDER_ENVELOPE_MULTIPLIER);
  const rawForEffectiveWindow = Math.ceil((providerAutoCompactTokenLimit * 100) / effectivePercent);
  const rawForCodexClamp = Math.ceil((providerAutoCompactTokenLimit * 10) / 9);
  return {
    displayContextWindow,
    providerRawContextWindow: Math.max(rawForEffectiveWindow, rawForCodexClamp),
    providerAutoCompactTokenLimit,
    catalogEffectiveContextWindowPercent: effectivePercent,
  };
}

export function appendCodexContextLaunchArgs(
  args: string[],
  launchConfig: CodexResolvedContextLaunchConfig | undefined,
): void {
  if (!launchConfig) return;
  if (launchConfig.modelCatalogConfigPath) {
    args.push("-c", `model_catalog_json=${JSON.stringify(launchConfig.modelCatalogConfigPath)}`);
  }
  args.push("-c", `model_context_window=${launchConfig.modelContextWindow}`);
  args.push("-c", `model_auto_compact_token_limit=${launchConfig.modelAutoCompactTokenLimit}`);
}

export async function resolveCodexContextWindowDiagnostics(options: {
  codexHome: string;
  configToml: string;
  generatedCatalogJson?: string;
  model?: string;
  role: "leader" | "non_leader";
  leaderMode?: CodexLeaderCompactionMode;
  configuredUsableContextWindow?: number;
  displayContextWindow?: number;
  launchConfig?: CodexResolvedContextLaunchConfig;
  leaderRecycleGuard?: boolean;
}): Promise<CodexContextWindowDiagnostics> {
  const autoCompactScope = readAutoCompactScope(options.configToml);
  const autoCompactTokenLimitScope = autoCompactScope.scope;
  const base = {
    role: options.role,
    ...(options.leaderMode ? { leaderMode: options.leaderMode } : {}),
    autoCompactTokenLimitScope,
    autoCompactTokenLimitScopeSource: autoCompactScope.source,
  };
  if (options.launchConfig) {
    return {
      ...base,
      capacitySource: options.leaderRecycleGuard ? "leader_recycle_guard" : "configured_usable_capacity",
      ...(options.configuredUsableContextWindow
        ? { configuredUsableContextWindow: options.configuredUsableContextWindow }
        : {}),
      ...(options.displayContextWindow ? { displayContextWindow: options.displayContextWindow } : {}),
      providerRawContextWindow: options.launchConfig.modelContextWindow,
      catalogEffectiveContextWindowPercent: options.launchConfig.catalogEffectiveContextWindowPercent,
      providerEffectiveContextWindow: Math.max(
        1,
        Math.floor(
          (options.launchConfig.modelContextWindow * options.launchConfig.catalogEffectiveContextWindowPercent) / 100,
        ),
      ),
      autoCompactTokenLimit: options.launchConfig.modelAutoCompactTokenLimit,
    };
  }

  const topLevelRaw = readTopLevelNumberSetting(options.configToml, "model_context_window");
  const topLevelAutoCompact = readTopLevelNumberSetting(options.configToml, "model_auto_compact_token_limit");
  const explicitScope = readTopLevelStringSetting(options.configToml, "model_auto_compact_token_limit_scope");
  const configuredCatalog = readTopLevelStringSetting(options.configToml, "model_catalog_json");
  const hasCodexContextConfig =
    !!topLevelRaw ||
    !!topLevelAutoCompact ||
    !!explicitScope ||
    (!!configuredCatalog && !configuredCatalogIsTakodeOwned(options.configToml));
  if (!hasCodexContextConfig) return { ...base, capacitySource: "codex_default" };

  const model = options.model || readTopLevelStringSetting(options.configToml, "model");
  const entry = await readConfiguredCatalogEntry(
    options.codexHome,
    options.configToml,
    model,
    options.generatedCatalogJson,
  );
  const entryMax = positiveNumber(entry?.max_context_window);
  const entryRaw = positiveNumber(entry?.context_window) || entryMax;
  const providerRawContextWindow = topLevelRaw ? (entryMax ? Math.min(topLevelRaw, entryMax) : topLevelRaw) : entryRaw;
  if (!providerRawContextWindow) return { ...base, capacitySource: "codex_config" };

  const effectivePercent = positiveNumber(entry?.effective_context_window_percent);
  const providerEffectiveContextWindow = effectivePercent
    ? Math.max(1, Math.floor((providerRawContextWindow * effectivePercent) / 100))
    : undefined;
  const catalogLimit = positiveNumber(entry?.auto_compact_token_limit);
  const contextDerivedLimit = providerEffectiveContextWindow
    ? Math.floor((providerEffectiveContextWindow * CODEX_DEFAULT_AUTO_COMPACT_PERCENT) / 100)
    : undefined;
  const autoCompactTokenLimit =
    autoCompactTokenLimitScope === "body_after_prefix" && topLevelAutoCompact
      ? topLevelAutoCompact
      : contextDerivedLimit
        ? Math.min(topLevelAutoCompact ?? catalogLimit ?? contextDerivedLimit, contextDerivedLimit)
        : undefined;
  return {
    ...base,
    capacitySource: "codex_config",
    ...(providerEffectiveContextWindow
      ? {
          displayContextWindow: providerEffectiveContextWindow,
          providerEffectiveContextWindow,
          catalogEffectiveContextWindowPercent: effectivePercent,
        }
      : {}),
    providerRawContextWindow,
    ...(autoCompactTokenLimit ? { autoCompactTokenLimit } : {}),
  };
}

function readAutoCompactScope(configToml: string): {
  scope: CodexAutoCompactTokenLimitScope;
  source: "configured" | "codex_default";
} {
  const configured = readTopLevelStringSetting(configToml, "model_auto_compact_token_limit_scope");
  if (configured === "body_after_prefix" || configured === "total") {
    return { scope: configured, source: "configured" };
  }
  return { scope: CODEX_DEFAULT_AUTO_COMPACT_TOKEN_LIMIT_SCOPE, source: "codex_default" };
}

export function logCodexContextWindowDiagnostics(
  sessionId: string,
  model: string | undefined,
  diagnostics: CodexContextWindowDiagnostics,
  modelCatalogConfigPath: string | undefined,
): void {
  contextLog.info("Resolved Codex context window diagnostics", {
    sessionId,
    model,
    modelCatalogConfigPath,
    ...diagnostics,
  });
}
