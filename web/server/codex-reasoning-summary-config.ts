import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { CodexCatalogResult } from "./codex-model-catalog.js";
import { loadCodexModelCatalog } from "./codex-model-catalog.js";

export type CodexReasoningSummaryLaunchMode = "auto" | "concise" | "detailed";

export function createCodexInstalledModelCatalogLoader(codexBinary?: string) {
  if (!codexBinary || process.env.VITEST) return undefined;
  return () => loadCodexModelCatalog({ codexBinary });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readTopLevelStringSetting(configToml: string, key: string): string | undefined {
  const lines = configToml.split("\n");
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`);

  for (const line of lines) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(keyPattern);
    if (!match?.[1]) continue;
    const raw = match[1].replace(/\s+#.*$/, "").trim();
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return raw.replace(/^["']|["']$/g, "");
    }
  }

  return undefined;
}

function resolveConfigPathValue(configDir: string, rawPath: string): string {
  if (rawPath.startsWith("~/")) {
    return join(homedir(), rawPath.slice(2));
  }
  return resolve(configDir, rawPath);
}

function findModelCatalogEntry(parsedCatalog: unknown, modelSlug: string): Record<string, any> | undefined {
  if (!Array.isArray((parsedCatalog as any)?.models)) return undefined;
  const modelEntry = (parsedCatalog as any).models.find((entry: any) => entry?.slug === modelSlug);
  return modelEntry && typeof modelEntry === "object" ? modelEntry : undefined;
}

function readModelCatalogEntryFromJson(
  catalogJson: string | undefined,
  modelSlug: string,
): Record<string, any> | undefined {
  if (!catalogJson) return undefined;
  try {
    return findModelCatalogEntry(JSON.parse(catalogJson), modelSlug);
  } catch {
    return undefined;
  }
}

export async function readCodexModelCatalogEntry(
  catalogPath: string,
  modelSlug: string,
): Promise<Record<string, any> | undefined> {
  try {
    return findModelCatalogEntry(JSON.parse(await readFile(catalogPath, "utf-8")), modelSlug);
  } catch {
    return undefined;
  }
}

function modelCatalogEntrySupportsReasoningSummaries(modelEntry: Record<string, any> | undefined): boolean {
  return modelEntry?.supports_reasoning_summaries === true;
}

function normalizeReasoningSummaryMode(
  value: string | undefined,
): CodexReasoningSummaryLaunchMode | "none" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed" || normalized === "none") {
    return normalized;
  }
  return undefined;
}

export async function resolveCodexReasoningSummaryLaunchMode(options: {
  codexHome: string;
  configToml: string;
  modelId?: string;
  generatedCatalogJson?: string;
  legacyCodexHome?: string;
  loadInstalledModelCatalog?: () => Promise<CodexCatalogResult | null>;
}): Promise<CodexReasoningSummaryLaunchMode | undefined> {
  const explicitSummaryConfig = normalizeReasoningSummaryMode(
    readTopLevelStringSetting(options.configToml, "model_reasoning_summary"),
  );
  if (explicitSummaryConfig === "none") return undefined;
  if (explicitSummaryConfig) return explicitSummaryConfig;

  const modelSlug = options.modelId || readTopLevelStringSetting(options.configToml, "model");
  if (!modelSlug) return undefined;

  const generatedEntry = readModelCatalogEntryFromJson(options.generatedCatalogJson, modelSlug);
  if (modelCatalogEntrySupportsReasoningSummaries(generatedEntry)) return "auto";

  const existingCatalogPathValue = readTopLevelStringSetting(options.configToml, "model_catalog_json");
  const sourceCatalogCandidates = [
    existingCatalogPathValue ? resolveConfigPathValue(options.codexHome, existingCatalogPathValue) : undefined,
    join(options.codexHome, "models_cache.json"),
    join(options.legacyCodexHome ?? join(homedir(), ".codex"), "models_cache.json"),
  ].filter((candidate, index, all): candidate is string => !!candidate && all.indexOf(candidate) === index);

  for (const sourceCatalogPath of sourceCatalogCandidates) {
    const modelEntry = await readCodexModelCatalogEntry(sourceCatalogPath, modelSlug);
    if (modelCatalogEntrySupportsReasoningSummaries(modelEntry)) return "auto";
    if (modelEntry?.supports_reasoning_summaries === false) return undefined;
  }

  const installedCatalog = await options.loadInstalledModelCatalog?.().catch(() => null);
  const installedEntry = installedCatalog?.models.find((model) => model.value === modelSlug);
  if (installedEntry?.supportsReasoningSummaries === true) return "auto";

  return undefined;
}
