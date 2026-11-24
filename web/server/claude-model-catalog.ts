import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inheritedLaunchEnv } from "./cli-launcher-env.js";
import { getEnrichedPath } from "./path-resolver.js";
import { machineSettingsFor } from "./remote-host/machine-settings.js";

/**
 * Claude model catalog as reported by the Claude Code CLI itself.
 *
 * The CLI resolves its model aliases (`default`, `opus`, `sonnet`, ...) from
 * its own release catalog plus the user's settings, including gateway
 * overrides such as a Copilot-routed Opus model. Takode cannot reproduce that
 * resolution statically, so it records the catalog each Claude SDK session
 * reports at initialization and serves the latest one to model menus. The
 * latest report is also saved, so menus keep it across server restarts. When
 * none is known yet, Takode starts Claude Code just long enough to read it.
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
/** Claude Code answers its initialize request within a few seconds; a probe that takes longer is stopped. */
const PROBE_TIMEOUT_MS = 20_000;

let latestCatalog: ClaudeBackendModelInfo[] | null = null;
/** Where reports are saved; null until the server loads the store, so other callers (tests) never write. */
let savePath: string | null = null;
let savedJson: string | null = null;
let pendingWrite: Promise<void> = Promise.resolve();
let probing: Promise<void> | null = null;

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

/**
 * The known catalog, or, when none is known yet, the one Claude Code reports
 * when `probe` starts it; null when that fails too. Callers share one probe at a
 * time, and its result is recorded like a session's report.
 */
export async function resolveClaudeModelCatalog(
  probe: () => Promise<unknown> = probeClaudeCodeCatalog,
): Promise<ClaudeBackendModelInfo[] | null> {
  if (latestCatalog) return latestCatalog;
  probing ??= probe()
    .then(recordClaudeModelCatalog, (err: unknown) =>
      console.warn("[claude-model-catalog] Could not read the model catalog from Claude Code:", err),
    )
    .finally(() => {
      probing = null;
    });
  await probing;
  return latestCatalog;
}

/**
 * The catalog's spelling of `model` when the catalog lists the same model ID
 * with dots and dashes swapped (`claude-fable-5-2` for `claude-fable-5.2`);
 * otherwise `model` unchanged. Claude Code accepts both spellings, but only
 * the one its provider lists gets the provider's context window: through
 * Copilot, Claude Code 2.1.311 counts 200K for `claude-fable-5-2` and compacts
 * early, while `claude-fable-5.2` gets Copilot's 1M.
 */
export function catalogClaudeModelId(model: string): string {
  if (!latestCatalog || latestCatalog.some((entry) => entry.value === model)) return model;
  const spelling = modelIdSpelling(model);
  return latestCatalog.find((entry) => modelIdSpelling(entry.value) === spelling)?.value ?? model;
}

function modelIdSpelling(id: string): string {
  return id.toLowerCase().replace(/\./g, "-");
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

/**
 * Start this machine's Claude Code as a session would, read the catalog it
 * reports at initialize, and stop it. No prompt is sent, so no model request
 * is made.
 */
async function probeClaudeCodeCatalog(): Promise<unknown> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const claudeBinary = machineSettingsFor(null).claudeBinary;
  const sdkQuery = query({
    // A prompt stream that never yields keeps Claude Code waiting for input.
    prompt: (async function* () {
      await new Promise(() => {});
    })(),
    options: {
      cwd: tmpdir(),
      env: { ...inheritedLaunchEnv(process.env), PATH: getEnrichedPath() },
      settingSources: ["user", "project", "local"],
      // Without a configured binary the SDK runs the Claude Code bundled with it, as sessions do.
      ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sdkQuery.supportedModels(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000}s`)), PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Ends the process, escalating to SIGKILL if it doesn't exit.
    sdkQuery.close();
  }
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
