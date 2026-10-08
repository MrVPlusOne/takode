import { useEffect, useState } from "react";
import { api, type AppSettings, type NamerConfig } from "../api.js";
import { NamerDebugPanel } from "./NamerDebugPanel.js";
import { SettingsSubsection, SettingsToggle } from "./settings-controls.js";

/** Auto-naming on/off (applies immediately) plus the naming backend config (saved with the button). */
export function SettingsSessionNamerSection({
  settings,
  loading,
  hidden = false,
}: {
  settings: AppSettings | null;
  loading: boolean;
  hidden?: boolean;
}) {
  const [enabled, setEnabled] = useState(true);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [backend, setBackend] = useState("claude");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.autoNamerEnabled ?? true);
    const config = settings.namerConfig;
    if (!config) return;
    setBackend(config.backend);
    if (config.backend === "openai") {
      setApiKey(config.apiKey === "***" ? "***" : config.apiKey || "");
      setBaseUrl(config.baseUrl || "");
    }
    setModel(config.model || "");
  }, [settings]);

  async function onToggle(next: boolean) {
    setEnabled(next);
    setToggleSaving(true);
    try {
      const res = await api.updateSettings({ autoNamerEnabled: next });
      setEnabled(res.autoNamerEnabled);
    } catch {
      setEnabled(!next);
    } finally {
      setToggleSaving(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const config: NamerConfig =
        backend === "openai"
          ? {
              backend: "openai",
              apiKey: apiKey === "***" ? "***" : apiKey,
              baseUrl,
              model,
            }
          : { backend: "claude", model: model || undefined };
      await api.updateSettings({ namerConfig: config });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono";

  return (
    <SettingsSubsection
      title="Session Namer"
      description="Automatically name sessions based on their content. Choose Claude CLI or an OpenAI-compatible API as the naming backend."
      hidden={hidden}
    >
      <SettingsToggle
        label="Auto-name sessions"
        checked={enabled}
        disabled={toggleSaving}
        onChange={(next) => void onToggle(next)}
      />

      <div>
        <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="namer-backend">
          Backend
        </label>
        <select
          id="namer-backend"
          value={backend}
          onChange={(e) => setBackend(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
        >
          <option value="claude">Claude CLI (default)</option>
          <option value="openai">OpenAI-compatible API</option>
        </select>
      </div>

      {backend === "claude" && (
        <div className="space-y-3 pl-3 border-l-2 border-cc-border">
          <div>
            <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="namer-claude-model">
              Model
            </label>
            <input
              id="namer-claude-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="haiku"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-cc-muted">
              Claude CLI model name passed to <code className="font-mono bg-cc-hover px-1 py-0.5 rounded">--model</code>
              . Defaults to haiku.
            </p>
          </div>
        </div>
      )}

      {backend === "openai" && (
        <div className="space-y-3 pl-3 border-l-2 border-cc-border">
          <div>
            <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="namer-api-key">
              API Key
            </label>
            <input
              id="namer-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onFocus={() => {
                if (apiKey === "***") setApiKey("");
              }}
              placeholder="sk-..."
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="namer-base-url">
              Base URL
            </label>
            <input
              id="namer-base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-cc-muted">
              Leave empty for OpenAI. Use a custom URL for LiteLLM, Ollama, etc.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="namer-model">
              Model
            </label>
            <input
              id="namer-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className={inputClass}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {error}
        </div>
      )}
      {saved && (
        <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
          Auto-namer settings saved.
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void onSave()}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            saving || loading
              ? "bg-cc-hover text-cc-muted cursor-not-allowed"
              : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
          }`}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <NamerDebugPanel />
    </SettingsSubsection>
  );
}
