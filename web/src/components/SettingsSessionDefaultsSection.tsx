import { useEffect, useMemo, useState } from "react";
import { api, type BackendModelInfo } from "../api.js";
import {
  CLAUDE_PERMISSION_MODES,
  CODEX_REASONING_EFFORTS,
  getModelsForBackend,
  toModelOptions,
  type ModelOption,
} from "../utils/backends.js";
import {
  contextWindowLimitWarning,
  contextWindowPreview,
  effectiveContextPercentForModel,
} from "../utils/context-window.js";
import {
  CLAUDE_1M_CONTEXT_TOKENS,
  CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
  CLAUDE_REASONING_EFFORTS,
  DEFAULT_SESSION_DEFAULTS,
  normalizeSessionDefaults,
  type SessionDefaultsSettings,
} from "../../shared/session-defaults.js";

const inputClass =
  "w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60";

function modelOptions(backend: "claude" | "codex", models: BackendModelInfo[]): ModelOption[] {
  const dynamic = models.length ? toModelOptions(models) : [];
  const fallback = getModelsForBackend(backend);
  const defaultOption = fallback.find((option) => option.value === "");
  return defaultOption ? [defaultOption, ...dynamic.filter((option) => option.value !== "")] : dynamic;
}

function numberInputValue(value: number | null): string {
  return value ? String(value) : "";
}

function parseOptionalPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function parsePercent(value: string): number {
  const numeric = parseOptionalPositiveInteger(value);
  return numeric && numeric >= 1 && numeric <= 100 ? numeric : CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
}

interface SettingsSessionDefaultsSectionProps {
  isActive?: boolean;
  sessionDefaults?: SessionDefaultsSettings | null;
  onSaved?: (defaults: SessionDefaultsSettings) => void;
}

export function SettingsSessionDefaultsSection({
  isActive = true,
  sessionDefaults,
  onSaved,
}: SettingsSessionDefaultsSectionProps) {
  const [defaults, setDefaults] = useState<SessionDefaultsSettings>(() => normalizeSessionDefaults(sessionDefaults));
  const [codexModels, setCodexModels] = useState<BackendModelInfo[]>([]);
  const [claudeModels, setClaudeModels] = useState<BackendModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDefaults(normalizeSessionDefaults(sessionDefaults ?? DEFAULT_SESSION_DEFAULTS));
  }, [sessionDefaults]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    api
      .getBackendModels("codex")
      .then((models) => {
        if (!cancelled) setCodexModels(models);
      })
      .catch(() => {});
    api
      .getBackendModels("claude")
      .then((models) => {
        if (!cancelled) setClaudeModels(models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const codexModelOptions = useMemo(() => modelOptions("codex", codexModels), [codexModels]);
  const claudeModelOptions = useMemo(() => modelOptions("claude", claudeModels), [claudeModels]);
  const selectedCodexModel = codexModels.find((model) => model.value === defaults.codex.model);
  const codexServiceTiers = selectedCodexModel?.serviceTiers ?? [];
  const selectedCodexModelOption = codexModelOptions.find((option) => option.value === defaults.codex.model);
  const codexEffectivePercent = effectiveContextPercentForModel(
    selectedCodexModelOption,
    defaults.codex.effectiveContextWindowPercent,
  );
  const codexContextWarning = contextWindowLimitWarning(defaults.codex.maxContextLength, selectedCodexModelOption);

  async function save(nextDefaults = defaults) {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await api.updateSettings({ sessionDefaults: nextDefaults });
      const savedDefaults = normalizeSessionDefaults(response.sessionDefaults);
      setDefaults(savedDefaults);
      onSaved?.(savedDefaults);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-cc-border pb-4 space-y-3" data-settings-item-id="session-defaults">
      <div>
        <h3 className="text-sm font-medium text-cc-fg">Session Defaults</h3>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-cc-muted">Codex</div>
          <select
            aria-label="Default Codex model"
            value={defaults.codex.model}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                codex: { ...current.codex, model: event.target.value, serviceTier: null },
              }))
            }
            className={inputClass}
          >
            {codexModelOptions.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Default Codex speed"
            value={defaults.codex.serviceTier ?? ""}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                codex: { ...current.codex, serviceTier: event.target.value || null },
              }))
            }
            className={inputClass}
          >
            <option value="">Standard</option>
            {codexServiceTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name || tier.id}
              </option>
            ))}
          </select>
          <select
            aria-label="Default Codex reasoning effort"
            value={defaults.codex.reasoningEffort}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                codex: {
                  ...current.codex,
                  reasoningEffort: event.target.value as typeof current.codex.reasoningEffort,
                },
              }))
            }
            className={inputClass}
          >
            <option value="">Backend default</option>
            {CODEX_REASONING_EFFORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-cc-hover px-3 py-2 text-sm text-cc-fg">
            <span>Internet access</span>
            <input
              type="checkbox"
              checked={defaults.codex.internetAccess}
              onChange={(event) =>
                setDefaults((current) => ({
                  ...current,
                  codex: { ...current.codex, internetAccess: event.target.checked },
                }))
              }
            />
          </label>
          <input
            aria-label="Default Codex max context length"
            type="number"
            min={1}
            value={numberInputValue(defaults.codex.maxContextLength)}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                codex: { ...current.codex, maxContextLength: parseOptionalPositiveInteger(event.target.value) },
              }))
            }
            placeholder="No override"
            className={inputClass}
          />
          <p className="text-xs text-cc-muted">
            Raw requested Codex context in tokens. Empty leaves the selected model/backend default unchanged.
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-cc-muted">Usable context estimate</span>
            <input
              aria-label="Default Codex usable context percent"
              type="number"
              min={1}
              max={100}
              value={defaults.codex.effectiveContextWindowPercent}
              onChange={(event) =>
                setDefaults((current) => ({
                  ...current,
                  codex: {
                    ...current.codex,
                    effectiveContextWindowPercent: parsePercent(event.target.value),
                  },
                }))
              }
              className={inputClass}
            />
          </label>
          <p className="text-xs leading-relaxed text-cc-muted">
            {contextWindowPreview(defaults.codex.maxContextLength, codexEffectivePercent)}
          </p>
          {codexContextWarning && (
            <p className="rounded-lg border border-cc-warning/30 bg-cc-warning/10 px-3 py-2 text-xs leading-relaxed text-cc-fg">
              {codexContextWarning}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-cc-muted">Claude</div>
          <select
            aria-label="Default Claude model"
            value={defaults.claude.model}
            onChange={(event) =>
              setDefaults((current) => ({ ...current, claude: { ...current.claude, model: event.target.value } }))
            }
            className={inputClass}
          >
            {claudeModelOptions.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Default Claude permission mode"
            value={defaults.claude.permissionMode}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                claude: { ...current.claude, permissionMode: event.target.value },
              }))
            }
            className={inputClass}
          >
            <option value="">Backend default</option>
            {CLAUDE_PERMISSION_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Default Claude reasoning effort"
            value={defaults.claude.reasoningEffort}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                claude: {
                  ...current.claude,
                  reasoningEffort: event.target.value as typeof current.claude.reasoningEffort,
                },
              }))
            }
            className={inputClass}
          >
            <option value="">Backend default</option>
            {CLAUDE_REASONING_EFFORTS.map((value) => (
              <option key={value} value={value}>
                {value === "max" ? "Max" : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
          <input
            aria-label="Default Claude max context length"
            type="number"
            min={1}
            value={numberInputValue(defaults.claude.maxContextLength)}
            onChange={(event) =>
              setDefaults((current) => ({
                ...current,
                claude: { ...current.claude, maxContextLength: parseOptionalPositiveInteger(event.target.value) },
              }))
            }
            placeholder="No override"
            className={inputClass}
          />
          <p className="text-xs text-cc-muted">
            Optional Claude context window in tokens. Empty leaves the backend default unchanged; currently supported
            value: {CLAUDE_1M_CONTEXT_TOKENS.toLocaleString()}.
          </p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-cc-error/10 px-3 py-2 text-xs text-cc-error">{error}</div>}
      {saved && <div className="rounded-lg bg-cc-success/10 px-3 py-2 text-xs text-cc-success">Defaults saved.</div>}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => save()}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            saving
              ? "bg-cc-hover text-cc-muted cursor-not-allowed"
              : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
          }`}
        >
          {saving ? "Saving..." : "Save Defaults"}
        </button>
      </div>
    </div>
  );
}
