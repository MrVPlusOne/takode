import { useEffect, useState } from "react";
import { api, type AppSettings, type PushoverEventFilters } from "../api.js";
import { NumberStepper, SettingsRow, SettingsSubsection, SettingsToggle } from "./settings-controls.js";

const DEFAULT_PUSHOVER_EVENT_FILTERS: PushoverEventFilters = {
  needsInput: true,
  review: true,
  notifyMe: true,
  error: true,
};

const EVENT_TYPE_OPTIONS: Array<{
  key: keyof PushoverEventFilters;
  label: string;
  description: string;
}> = [
  {
    key: "needsInput",
    label: "Needs user input",
    description: "Questions and permission requests.",
  },
  {
    key: "review",
    label: "Ready for review",
    description: "Completed turns that need your eyes.",
  },
  {
    key: "notifyMe",
    label: "Notify Me",
    description: "New results in threads you track.",
  },
  {
    key: "error",
    label: "Errors",
    description: "Turn failures that require attention.",
  },
];

/**
 * Event types and delay shared by every phone channel. Web Push and Pushover
 * use the same alert scheduler, so these rules live above both channels and
 * apply as soon as they change.
 */
export function SettingsPhoneAlertRules({
  settings,
  hidden = false,
}: {
  settings: AppSettings | null;
  hidden?: boolean;
}) {
  const [eventFilters, setEventFilters] = useState<PushoverEventFilters>(DEFAULT_PUSHOVER_EVENT_FILTERS);
  const [delaySeconds, setDelaySeconds] = useState(30);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!settings) return;
    setEventFilters(settings.pushoverEventFilters ?? DEFAULT_PUSHOVER_EVENT_FILTERS);
    setDelaySeconds(settings.pushoverDelaySeconds);
  }, [settings]);

  async function save(patch: { pushoverEventFilters?: PushoverEventFilters; pushoverDelaySeconds?: number }) {
    const previous = { eventFilters, delaySeconds };
    if (patch.pushoverEventFilters) setEventFilters(patch.pushoverEventFilters);
    if (patch.pushoverDelaySeconds !== undefined) setDelaySeconds(patch.pushoverDelaySeconds);
    setError("");
    try {
      const res = await api.updateSettings(patch);
      setEventFilters(res.pushoverEventFilters ?? DEFAULT_PUSHOVER_EVENT_FILTERS);
      setDelaySeconds(res.pushoverDelaySeconds);
    } catch (err: unknown) {
      setEventFilters(previous.eventFilters);
      setDelaySeconds(previous.delaySeconds);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsSubsection
      title="Phone Alert Rules"
      description="Which events send a phone alert, and how long to wait first. Applies to Web Push and Pushover."
      hidden={hidden}
    >
      <div className="rounded-lg border border-cc-border overflow-hidden">
        {EVENT_TYPE_OPTIONS.map((option, index) => (
          <label
            key={option.key}
            className={`flex items-start gap-3 px-3 py-3 bg-cc-hover/40 cursor-pointer ${index > 0 ? "border-t border-cc-border" : ""}`}
          >
            <input
              type="checkbox"
              checked={eventFilters[option.key]}
              onChange={(e) =>
                void save({
                  pushoverEventFilters: {
                    ...eventFilters,
                    [option.key]: e.target.checked,
                  },
                })
              }
              className="mt-0.5 accent-cc-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm text-cc-fg">{option.label}</span>
              <span className="block text-xs text-cc-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      <SettingsRow label="Delay" htmlFor="phone-alert-delay" description="Wait this long before sending (5-300s).">
        <NumberStepper
          id="phone-alert-delay"
          label="delay"
          value={delaySeconds}
          step={5}
          min={5}
          max={300}
          suffix="s"
          onChange={(next) => void save({ pushoverDelaySeconds: next })}
        />
      </SettingsRow>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {error}
        </div>
      )}
    </SettingsSubsection>
  );
}

/** Pushover credentials and on/off. Credentials save with the button; the switch applies immediately. */
export function SettingsPushoverSection({
  settings,
  loading,
  hidden = false,
}: {
  settings: AppSettings | null;
  loading: boolean;
  hidden?: boolean;
}) {
  const [userKey, setUserKey] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setConfigured(settings.pushoverConfigured);
    setEnabled(settings.pushoverEnabled);
    setBaseUrl(settings.pushoverBaseUrl || "");
  }, [settings]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const payload: Parameters<typeof api.updateSettings>[0] = {
        pushoverBaseUrl: baseUrl.trim(),
      };
      if (userKey.trim()) payload.pushoverUserKey = userKey.trim();
      if (apiToken.trim()) payload.pushoverApiToken = apiToken.trim();
      const res = await api.updateSettings(payload);
      setConfigured(res.pushoverConfigured);
      setBaseUrl(res.pushoverBaseUrl || "");
      setUserKey("");
      setApiToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleEnabled(next: boolean) {
    setEnabled(next);
    setError("");
    try {
      const res = await api.updateSettings({ pushoverEnabled: next });
      setEnabled(res.pushoverEnabled);
    } catch (err: unknown) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testPushover();
      setTestResult({ ok: res.ok });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  }

  const inputClass =
    "w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60";

  return (
    <SettingsSubsection
      title="Pushover"
      description="Push notifications through the Pushover app. Get credentials at pushover.net."
      as="form"
      onSubmit={onSave}
      hidden={hidden}
    >
      <SettingsToggle label="Send Pushover alerts" checked={enabled} onChange={(next) => void onToggleEnabled(next)} />

      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="po-user-key">
          User Key
        </label>
        <input
          id="po-user-key"
          type="password"
          value={userKey}
          onChange={(e) => setUserKey(e.target.value)}
          placeholder={configured ? "Configured. Enter a new key to replace." : "Your Pushover user key"}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="po-api-token">
          API Token
        </label>
        <input
          id="po-api-token"
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder={configured ? "Configured. Enter a new token to replace." : "Your Pushover API/app token"}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5" htmlFor="po-base-url">
          Base URL
        </label>
        <input
          id="po-base-url"
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://localhost:3456"
          className={inputClass}
        />
        <p className="mt-1.5 text-xs text-cc-muted">
          The URL your phone uses to reach this server. Used for deep links in notifications.
        </p>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {error}
        </div>
      )}

      {saved && (
        <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
          Pushover settings saved.
        </div>
      )}

      {testResult && (
        <div
          className={`px-3 py-2 rounded-lg text-xs ${
            testResult.ok
              ? "bg-cc-success/10 border border-cc-success/20 text-cc-success"
              : "bg-cc-error/10 border border-cc-error/20 text-cc-error"
          }`}
        >
          {testResult.ok ? "Test notification sent!" : `Test failed: ${testResult.error}`}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-cc-muted">
            {loading ? "Loading..." : configured ? "Pushover configured" : "Not configured"}
          </span>
          {configured && (
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                testing
                  ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                  : "bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
              }`}
            >
              {testing ? "Sending..." : "Send Test"}
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={saving || loading}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            saving || loading
              ? "bg-cc-hover text-cc-muted cursor-not-allowed"
              : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
          }`}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </SettingsSubsection>
  );
}
