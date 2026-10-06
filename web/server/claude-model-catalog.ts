/**
 * Claude model catalog as reported by the Claude Code CLI itself.
 *
 * The CLI resolves its model aliases (`default`, `opus`, `sonnet`, ...) from
 * its own release catalog plus the user's settings, including gateway
 * overrides such as a Copilot-routed Opus model. Takode cannot reproduce that
 * resolution statically, so it records the catalog each Claude SDK session
 * reports at initialization and serves the latest one to model menus.
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

let latestCatalog: ClaudeBackendModelInfo[] | null = null;

/** Record the raw `supportedModels()` result from a Claude SDK session. Empty or malformed input is ignored. */
export function recordClaudeModelCatalog(raw: unknown): void {
  const models = mapClaudeCatalogModels(raw);
  if (models.length > 0) latestCatalog = models;
}

/** Latest CLI-reported catalog since server start, or null before any Claude session has initialized. */
export function getClaudeModelCatalog(): ClaudeBackendModelInfo[] | null {
  return latestCatalog;
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
