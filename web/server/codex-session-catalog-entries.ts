/**
 * Model entries of the session-local Codex catalogs Takode writes. Codex takes
 * each model's built-in (base) prompt and tool setup from its catalog entry, so
 * an entry Takode adds or repairs must carry what Codex itself would use for
 * that model, never an invented minimal entry with an empty prompt.
 */

export interface CodexModelCatalog {
  models: unknown[];
}

/**
 * Settle the model entries of a catalog Takode is about to write and return the
 * selected model's entry, or undefined when the catalog should not get one.
 *
 * - An entry with no built-in prompt (one an older Takode synthesized, or one
 *   Codex could not use) is replaced by the entry Codex resolves for its slug,
 *   or removed when Codex knows no entry for it.
 * - A missing selected model gets the entry Codex itself would use: its lookup
 *   in this catalog, else in the CLI's bundled catalog. A model unknown to both
 *   gets no entry, so Codex runs it with its own generic prompt and tools.
 * - Every entry gets the fields Codex's parser requires, because Codex parses
 *   the whole catalog at startup.
 *
 * `loadCodexCatalog` (the bundled catalog) is called only when needed.
 */
export async function settleCodexCatalogModelEntries(
  models: unknown[],
  modelSlug: string,
  options: {
    loadCodexCatalog?: () => Promise<CodexModelCatalog | null>;
    /** Add the selected model when the catalog lacks it. */
    addMissingModel?: boolean;
  },
): Promise<{ modelEntry?: Record<string, any>; changed: boolean }> {
  let codexModels: unknown[] | undefined;
  const loadCodexModels = async () => {
    codexModels ??= (await options.loadCodexCatalog?.().catch(() => null))?.models ?? [];
    return codexModels;
  };
  let changed = false;

  for (let index = models.length - 1; index >= 0; index--) {
    const entry = models[index];
    if (!isSlugEntry(entry) || hasCodexModelInstructions(entry)) continue;
    const codexEntry = findCodexCatalogModel(entry.slug, await loadCodexModels());
    // Without an entry Codex falls back to its generic prompt; an entry with
    // no prompt would make it send none.
    if (codexEntry) models[index] = { ...structuredClone(codexEntry), slug: entry.slug };
    else models.splice(index, 1);
    changed = true;
  }

  let modelEntry = models.find((entry): entry is Record<string, any> => isSlugEntry(entry) && entry.slug === modelSlug);
  if (!modelEntry && options.addMissingModel) {
    const codexEntry =
      findCodexCatalogModel(modelSlug, models) ?? findCodexCatalogModel(modelSlug, await loadCodexModels());
    if (codexEntry) {
      modelEntry = { ...structuredClone(codexEntry), slug: modelSlug };
      models.push(modelEntry);
      changed = true;
    } else {
      console.warn(`[cli-launcher] No Codex catalog knows model ${modelSlug}; Codex uses its generic prompt for it.`);
    }
  }

  for (const entry of models) {
    if (isSlugEntry(entry) && ensureCodexModelEntrySchemaDefaults(entry, entry.slug)) changed = true;
  }
  return { modelEntry, changed };
}

/**
 * Codex's own catalog lookup (`construct_model_info_from_candidates`): the
 * entry whose slug is the longest prefix of the model, else the same for a
 * single `namespace/model` slug without its namespace. Only entries that carry
 * a built-in prompt are candidates.
 */
export function findCodexCatalogModel(modelSlug: string, models: unknown[]): Record<string, any> | undefined {
  const candidates = models.filter(
    (entry): entry is Record<string, any> => isSlugEntry(entry) && hasCodexModelInstructions(entry),
  );
  const longestPrefixMatch = (slug: string) =>
    candidates
      .filter((entry) => slug.startsWith(entry.slug))
      .reduce<Record<string, any> | undefined>(
        (best, entry) => (best && best.slug.length >= entry.slug.length ? best : entry),
        undefined,
      );
  const namespaced = /^([A-Za-z0-9_-]+)\/([^/]+)$/.exec(modelSlug);
  return longestPrefixMatch(modelSlug) ?? (namespaced ? longestPrefixMatch(namespaced[2]) : undefined);
}

/**
 * Whether an entry carries a built-in prompt: Codex reads
 * `model_messages.instructions_template`, or the legacy `base_instructions`.
 */
function hasCodexModelInstructions(entry: Record<string, any>): boolean {
  const template = entry.model_messages?.instructions_template;
  return (
    (typeof template === "string" && template.trim() !== "") ||
    (typeof entry.base_instructions === "string" && entry.base_instructions.trim() !== "")
  );
}

function isSlugEntry(entry: unknown): entry is Record<string, any> {
  return !!entry && typeof entry === "object" && typeof (entry as { slug?: unknown }).slug === "string";
}

function displayNameFromModelSlug(modelSlug: string): string {
  if (/^gpt-/i.test(modelSlug)) return `GPT-${modelSlug.slice(4)}`;
  return modelSlug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function ensureCodexModelEntrySchemaDefaults(modelEntry: Record<string, any>, modelSlug: string): boolean {
  let changed = false;
  const setDefault = (key: string, value: any, isValid: (current: unknown) => boolean) => {
    if (isValid(modelEntry[key])) return;
    modelEntry[key] = value;
    changed = true;
  };

  setDefault("display_name", displayNameFromModelSlug(modelSlug), (value) => typeof value === "string");
  if (Array.isArray(modelEntry.supported_reasoning_levels)) {
    const levels = normalizeCatalogReasoningLevels(modelEntry.supported_reasoning_levels);
    if (JSON.stringify(levels) !== JSON.stringify(modelEntry.supported_reasoning_levels)) {
      modelEntry.supported_reasoning_levels = levels;
      changed = true;
    }
  }
  setDefault(
    "supported_reasoning_levels",
    [
      { effort: "low", description: "Fast responses with lighter reasoning" },
      {
        effort: "medium",
        description: "Balances speed and reasoning depth for everyday tasks",
      },
      {
        effort: "high",
        description: "Greater reasoning depth for complex problems",
      },
      {
        effort: "xhigh",
        description: "Extra high reasoning depth for complex problems",
      },
      {
        effort: "max",
        description: "Maximum reasoning depth for the hardest problems",
      },
      {
        effort: "ultra",
        description: "Maximum reasoning that may proactively use multiple agents",
      },
    ],
    Array.isArray,
  );
  setDefault("shell_type", "shell_command", (value) => typeof value === "string");
  setDefault("visibility", "list", (value) => typeof value === "string");
  setDefault("supported_in_api", true, (value) => typeof value === "boolean");
  setDefault("priority", 0, (value) => typeof value === "number" && Number.isFinite(value));
  setDefault("supports_reasoning_summaries", true, (value) => typeof value === "boolean");
  setDefault("support_verbosity", true, (value) => typeof value === "boolean");
  setDefault(
    "truncation_policy",
    { mode: "tokens", limit: 10000 },
    (value) =>
      !!value &&
      typeof value === "object" &&
      typeof (value as any).mode === "string" &&
      typeof (value as any).limit === "number",
  );
  setDefault("supports_parallel_tool_calls", true, (value) => typeof value === "boolean");
  setDefault("experimental_supported_tools", [], Array.isArray);

  return changed;
}

/**
 * Codex requires each supported reasoning level to be `{ effort, description }`.
 * Turn bare effort strings into that shape, give a missing description an empty
 * one, keep any other fields, and drop entries that name no effort.
 */
function normalizeCatalogReasoningLevels(levels: unknown[]): Record<string, unknown>[] {
  return levels.flatMap((level) => {
    if (typeof level === "string") return level.trim() ? [{ effort: level.trim(), description: "" }] : [];
    if (!level || typeof level !== "object") return [];
    const item = level as Record<string, unknown>;
    if (typeof item.effort !== "string" || !item.effort.trim()) return [];
    return [
      {
        ...item,
        description: typeof item.description === "string" ? item.description : "",
      },
    ];
  });
}
