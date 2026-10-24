import { useEffect, useState } from "react";
import { api, type AppSettings } from "../api.js";
import { SettingsRow, SettingsSubsection } from "./settings-controls.js";

type ScribeBackend = NonNullable<AppSettings["scribeBackend"]>;

/**
 * Which backend runs a leader's Scribe, the worker that keeps its Library topic pages. The default
 * matches each leader's own backend, so users with only one backend can use topics; a change
 * applies to Scribes started afterwards.
 */
export function SettingsScribeSection({
  settings,
  hidden = false,
}: {
  settings: AppSettings | null;
  hidden?: boolean;
}) {
  const [backend, setBackend] = useState<ScribeBackend>("leader");
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings?.scribeBackend) setBackend(settings.scribeBackend);
  }, [settings]);

  async function save(next: ScribeBackend) {
    const previous = backend;
    setBackend(next);
    setError("");
    try {
      const res = await api.updateSettings({ scribeBackend: next });
      setBackend(res.scribeBackend ?? "leader");
    } catch (err: unknown) {
      setBackend(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsSubsection
      title="Scribes"
      description="A leader with Library topics on has a Scribe, a worker in its herd that keeps the topic pages. Choose which backend Scribes run on; it applies to Scribes started afterwards."
      hidden={hidden}
    >
      <SettingsRow label="Scribe backend" htmlFor="scribe-backend">
        <select
          id="scribe-backend"
          value={backend}
          onChange={(event) => void save(event.target.value as ScribeBackend)}
          className="w-full px-3 py-2 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
        >
          <option value="leader">Same as the leader (default)</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </SettingsRow>
      {error && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {error}
        </div>
      )}
    </SettingsSubsection>
  );
}
