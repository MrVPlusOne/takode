import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Claude model catalog as reported by the Claude Code CLI itself.
 *
 * The CLI resolves its model aliases (`default`, `opus`, `sonnet`, ...) from
 * its own release catalog plus the user's settings, including gateway
 * overrides such as a Copilot-routed Opus model. Takode cannot reproduce that
 * resolution statically, so it records the catalog each Claude SDK session
 * reports at initialization and serves the latest one to model menus. The
 * latest report is also saved, so menus keep it across server restarts
 * instead of falling back to generic aliases until a session initializes.
 */

export interface ClaudeBackendModelInfo {
  value: string;
  label: string;
  description: string;
  /** True for the entry the CLI's own default resolves to; lets menus skip other default-model guesses. */
  isDefault?: boolean;
  /** Effort levels the CLI accepts for this model; empty when the model has no effort control. */
  supportedReasoningLevels: Array<{ effort: string }>;
}

const DEFAULT_PATH = join(homedir(), ".companion", "claude-model-catalog.json");

let latestCatalog: ClaudeBackendModelInfo[] | null = null;
/** Where reports are saved; null until the server loads the store, so other callers (tests) never write. */
let savePath: string | null = null;
let savedJson: string | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

/**
 * Load the catalog saved by an earlier server run and save later reports to
 * `path`. A report recorded while the file is read is newer and wins.
 */
export async function loadClaudeModelCatalog(path = DEFAULT_PATH): Promise<void> {
  savePath = path;
  let saved: unknown;
  try {
    saved = JSON.parse(await readFile(path, "utf-8"))?.models;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[claude-model-catalog] Ignoring unreadable saved catalog ${path}:`, err);
    }
    return;
  }
  const models = mapClaudeCatalogModels(saved);
  if (models.length > 0 && !latestCatalog) latestCatalog = models;
}

/** Record the raw `supportedModels()` result from a Claude SDK session. Empty or malformed input is ignored. */
export function recordClaudeModelCatalog(raw: unknown): void {
  const models = mapClaudeCatalogModels(raw);
  if (models.length === 0) return;
  latestCatalog = models;
  // The raw list is saved so a later mapping change applies to it on load.
  const json = `${JSON.stringify({ models: raw }, null, 2)}\n`;
  const path = savePath;
  if (!path || json === savedJson) return;
  savedJson = json;
  pendingWrite = pendingWrite
    .then(() => mkdir(dirname(path), { recursive: true }))
    .then(() => writeFile(path, json))
    .catch((err: unknown) => console.warn(`[claude-model-catalog] Could not save the catalog to ${path}:`, err));
}

/** Latest CLI-reported catalog (from this run or saved by an earlier one), or null when none is known. */
export function getClaudeModelCatalog(): ClaudeBackendModelInfo[] | null {
  return latestCatalog;
}

/** Resolves once every queued save has finished. */
export function _flushClaudeModelCatalogForTest(): Promise<void> {
  return pendingWrite;
}

/**
 * Map CLI model entries to menu options keyed by the concrete model each alias
 * resolves to, so selecting an option sends that exact model and the composer
 * shows it. Aliases resolving to the same model collapse into the first entry;
 * the CLI lists `default` first, so its model is labeled "(default)".
 */
export function mapClaudeCatalogModels(raw: unknown): ClaudeBackendModelInfo[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const models: ClaudeBackendModelInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { value, resolvedModel, displayName, description, supportedEffortLevels } = entry as Record<string, unknown>;
    if (typeof value !== "string" || !value) continue;
    // `resolvedModel` is reported by newer CLIs but not yet typed by the SDK.
    const resolved = typeof resolvedModel === "string" && resolvedModel ? resolvedModel : null;
    const id = resolved ?? value;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = (resolved && claudeModelName(resolved)) || (typeof displayName === "string" && displayName) || value;
    const isDefault = value === "default";
    models.push({
      value: id,
      label: isDefault && resolved ? `${name} (default)` : name,
      description: typeof description === "string" ? description : "",
      ...(isDefault ? { isDefault } : {}),
      // The CLI omits effort levels for models without effort support (e.g. Haiku).
      supportedReasoningLevels: Array.isArray(supportedEffortLevels)
        ? supportedEffortLevels.filter((level) => typeof level === "string").map((effort) => ({ effort }))
        : [],
    });
  }
  return models;
}

/** "claude-opus-5.5" -> "Opus 5.5", "claude-sonnet-4-5-20250929" -> "Sonnet 4.5", "claude-opus-4-6[1m]" -> "Opus 4.6 [1M]". */
function claudeModelName(id: string): string | null {
  const match = id.match(/^claude-(.+?)(\[.+\])?$/);
  if (!match) return null;
  const base = match[1]
    .replace(/-\d{8}$/, "")
    .replace(/(\d)-(?=\d)/g, "$1.")
    .replace(/-/g, " ");
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  return match[2] ? `${name} ${match[2].toUpperCase()}` : name;
}
