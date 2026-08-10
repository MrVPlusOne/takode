import { useEffect, useMemo, useState } from "react";
import { api, type BackendModelInfo } from "../api.js";
import {
  CLAUDE_PERMISSION_MODES,
  getCodexReasoningEffortOptions,
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
  workerSessionRoleDefaults,
  type SessionDefaultsSettings,
  type SessionRoleDefaults,
} from "../../shared/session-defaults.js";

const inputClass =
  "w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 disabled:cursor-not-allowed disabled:opacity-60";

function modelOptions(backend: "claude" | "codex", models: BackendModelInfo[], currentModel: string): ModelOption[] {
  const dynamic = models.length ? toModelOptions(models) : [];
  const fallback = getModelsForBackend(backend);
  const defaultOption = fallback.find((option) => option.value === "");
  const merged = defaultOption ? [defaultOption, ...dynamic.filter((option) => option.value !== "")] : dynamic;
  if (currentModel && !merged.some((option) => option.value === currentModel)) {
    merged.push({ value: currentModel, label: currentModel, icon: "" });
  }
  return merged;
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

interface RoleDefaultsEditorProps {
  id: string;
  label: string;
  defaults: SessionRoleDefaults;
  codexModels: BackendModelInfo[];
  claudeModels: BackendModelInfo[];
  effectiveContextWindowPercent: number;
  disabled?: boolean;
  onChange: (defaults: SessionRoleDefaults) => void;
}

function RoleDefaultsEditor({
  id,
  label,
  defaults,
  codexModels,
  claudeModels,
  effectiveContextWindowPercent,
  disabled = false,
  onChange,
}: RoleDefaultsEditorProps) {
  const codexModelOptions = useMemo(
    () => modelOptions("codex", codexModels, defaults.codex.model),
    [codexModels, defaults.codex.model],
  );
  const claudeModelOptions = useMemo(
    () => modelOptions("claude", claudeModels, defaults.claude.model),
    [claudeModels, defaults.claude.model],
  );
  const selectedCodexModel = codexModels.find((model) => model.value === defaults.codex.model);
  const selectedCodexModelOption = codexModelOptions.find((option) => option.value === defaults.codex.model);
  const codexServiceTiers = selectedCodexModel?.serviceTiers ?? [];
  const codexReasoningOptions = getCodexReasoningEffortOptions({
    modelOptions: codexModelOptions,
    model: defaults.codex.model,
    currentEffort: defaults.codex.reasoningEffort,
    includeDefault: false,
  });
  const codexEffectivePercent = effectiveContextPercentForModel(
    selectedCodexModelOption,
    effectiveContextWindowPercent,
  );
  const codexContextWarning = contextWindowLimitWarning(defaults.codex.maxContextLength, selectedCodexModelOption, {
    effectivePercent: codexEffectivePercent,
  });

  return (
    <fieldset
      id={id}
      disabled={disabled}
      aria-disabled={disabled}
      className={`grid gap-4 rounded-xl border border-cc-border p-4 lg:grid-cols-2 ${disabled ? "opacity-70" : ""}`}
    >
      <legend className="sr-only">{label}</legend>
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-cc-muted">Codex</div>
        <select
          aria-label={`${label} Codex model`}
          value={defaults.codex.model}
          onChange={(event) =>
            onChange({
              ...defaults,
              codex: { ...defaults.codex, model: event.target.value, serviceTier: null },
            })
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
          aria-label={`${label} Codex speed`}
          value={defaults.codex.serviceTier ?? ""}
          onChange={(event) =>
            onChange({ ...defaults, codex: { ...defaults.codex, serviceTier: event.target.value || null } })
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
          aria-label={`${label} Codex reasoning effort`}
          value={defaults.codex.reasoningEffort}
          onChange={(event) =>
            onChange({ ...defaults, codex: { ...defaults.codex, reasoningEffort: event.target.value } })
          }
          className={inputClass}
        >
          <option value="">Backend default</option>
          {codexReasoningOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-cc-hover px-3 py-2 text-sm text-cc-fg">
          <span>Internet access</span>
          <input
            aria-label={`${label} Codex internet access`}
            type="checkbox"
            checked={defaults.codex.internetAccess}
            onChange={(event) =>
              onChange({ ...defaults, codex: { ...defaults.codex, internetAccess: event.target.checked } })
            }
          />
        </label>
        <input
          aria-label={`${label} Codex usable context capacity`}
          type="number"
          min={1}
          value={numberInputValue(defaults.codex.maxContextLength)}
          onChange={(event) =>
            onChange({
              ...defaults,
              codex: { ...defaults.codex, maxContextLength: parseOptionalPositiveInteger(event.target.value) },
            })
          }
          placeholder="No override"
          className={inputClass}
        />
        <p className="text-xs text-cc-muted">
          Desired usable Codex capacity in tokens. Empty leaves the selected model/backend default unchanged.
        </p>
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
          aria-label={`${label} Claude model`}
          value={defaults.claude.model}
          onChange={(event) => onChange({ ...defaults, claude: { ...defaults.claude, model: event.target.value } })}
          className={inputClass}
        >
          {claudeModelOptions.map((option) => (
            <option key={option.value || "default"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} Claude permission mode`}
          value={defaults.claude.permissionMode}
          onChange={(event) =>
            onChange({ ...defaults, claude: { ...defaults.claude, permissionMode: event.target.value } })
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
          aria-label={`${label} Claude reasoning effort`}
          value={defaults.claude.reasoningEffort}
          onChange={(event) =>
            onChange({
              ...defaults,
              claude: {
                ...defaults.claude,
                reasoningEffort: event.target.value as typeof defaults.claude.reasoningEffort,
              },
            })
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
          aria-label={`${label} Claude max context length`}
          type="number"
          min={1}
          value={numberInputValue(defaults.claude.maxContextLength)}
          onChange={(event) =>
            onChange({
              ...defaults,
              claude: { ...defaults.claude, maxContextLength: parseOptionalPositiveInteger(event.target.value) },
            })
          }
          placeholder="No override"
          className={inputClass}
        />
        <p className="text-xs text-cc-muted">
          Optional Claude context window in tokens. Empty leaves the backend default unchanged; currently supported
          value: {CLAUDE_1M_CONTEXT_TOKENS.toLocaleString()}.
        </p>
      </div>
    </fieldset>
  );
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
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dirty) setDefaults(normalizeSessionDefaults(sessionDefaults ?? DEFAULT_SESSION_DEFAULTS));
  }, [sessionDefaults]); // Preserve local edits until save resolves.

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

  const workerDefaults = workerSessionRoleDefaults(defaults);
  const displayedLeaderDefaults = defaults.leaderUsesWorkerDefaults ? workerDefaults : defaults.leader;

  function updateWorker(next: SessionRoleDefaults) {
    setDirty(true);
    setDefaults((current) => ({
      ...current,
      codex: { ...next.codex, effectiveContextWindowPercent: current.codex.effectiveContextWindowPercent },
      claude: next.claude,
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await api.updateSettings({ sessionDefaults: defaults });
      const savedDefaults = normalizeSessionDefaults(response.sessionDefaults);
      setDefaults(savedDefaults);
      setDirty(false);
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
    <div className="border-b border-cc-border pb-4 space-y-4" data-settings-item-id="session-defaults">
      <div>
        <h3 className="text-sm font-medium text-cc-fg">Session Defaults</h3>
        <p className="mt-1 text-xs text-cc-muted">
          Applied to future sessions when creation does not specify an override.
        </p>
      </div>

      <section className="space-y-2" aria-labelledby="worker-defaults-heading">
        <div>
          <h4 id="worker-defaults-heading" className="text-sm font-medium text-cc-fg">
            Worker Defaults
          </h4>
          <p className="mt-0.5 text-xs text-cc-muted">Used by worker and other non-leader sessions.</p>
        </div>
        <RoleDefaultsEditor
          id="worker-default-controls"
          label="Worker defaults"
          defaults={workerDefaults}
          codexModels={codexModels}
          claudeModels={claudeModels}
          effectiveContextWindowPercent={defaults.codex.effectiveContextWindowPercent}
          onChange={updateWorker}
        />
      </section>

      <section className="space-y-2" aria-labelledby="leader-defaults-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 id="leader-defaults-heading" className="text-sm font-medium text-cc-fg">
              Leader Defaults
            </h4>
            <p className="mt-0.5 text-xs text-cc-muted">Used only for newly created leader sessions.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-cc-fg">
            <input
              type="checkbox"
              aria-controls="leader-default-controls"
              checked={defaults.leaderUsesWorkerDefaults}
              onChange={(event) => {
                setDirty(true);
                setDefaults((current) => ({ ...current, leaderUsesWorkerDefaults: event.target.checked }));
              }}
            />
            <span>Use same as worker defaults</span>
          </label>
        </div>
        {defaults.leaderUsesWorkerDefaults && (
          <p className="rounded-lg bg-cc-hover px-3 py-2 text-xs text-cc-muted">
            Leader sessions dynamically use the current Worker Defaults. Saved independent leader values are retained.
          </p>
        )}
        <RoleDefaultsEditor
          id="leader-default-controls"
          label="Leader defaults"
          defaults={displayedLeaderDefaults}
          codexModels={codexModels}
          claudeModels={claudeModels}
          effectiveContextWindowPercent={defaults.codex.effectiveContextWindowPercent}
          disabled={defaults.leaderUsesWorkerDefaults}
          onChange={(leader) => {
            setDirty(true);
            setDefaults((current) => ({ ...current, leader }));
          }}
        />
      </section>

      <section className="rounded-xl border border-cc-border p-4 space-y-2" aria-labelledby="context-estimate-heading">
        <div>
          <h4 id="context-estimate-heading" className="text-sm font-medium text-cc-fg">
            Global Context Estimate
          </h4>
          <p className="mt-0.5 text-xs text-cc-muted">
            Used for Codex context previews for both roles. It does not become a per-session launch override.
          </p>
        </div>
        <label className="block max-w-sm space-y-1.5">
          <span className="text-xs font-medium text-cc-muted">Usable context estimate</span>
          <input
            aria-label="Codex usable context estimate percent"
            type="number"
            min={1}
            max={100}
            value={defaults.codex.effectiveContextWindowPercent}
            onChange={(event) => {
              setDirty(true);
              setDefaults((current) => ({
                ...current,
                codex: { ...current.codex, effectiveContextWindowPercent: parsePercent(event.target.value) },
              }));
            }}
            className={inputClass}
          />
        </label>
      </section>

      {error && <div className="rounded-lg bg-cc-error/10 px-3 py-2 text-xs text-cc-error">{error}</div>}
      {saved && <div className="rounded-lg bg-cc-success/10 px-3 py-2 text-xs text-cc-success">Defaults saved.</div>}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={save}
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
