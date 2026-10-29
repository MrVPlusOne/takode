import { useEffect, useState } from "react";
import { api, type AppSettings } from "../api.js";
import { SettingsRow, SettingsSubsection, SettingsToggle } from "./settings-controls.js";

type ScribeBackend = NonNullable<AppSettings["scribeBackend"]>;

/**
 * Library topics for leaders, on by default: the switch turns them off for every leader (their
 * Scribes stop), saving the Scribes' tokens. And which backend runs a leader's Scribe, the worker
 * that keeps its topic pages. The default matches each leader's own backend, so users with only one
 * backend can use topics; a change applies to Scribes started afterwards.
 */
export function SettingsScribeSection({
  settings,
  hidden = false,
}: {
  settings: AppSettings | null;
  hidden?: boolean;
}) {
  const [backend, setBackend] = useState<ScribeBackend>("leader");
  const [topicsOn, setTopicsOn] = useState(true);
  const [savingTopics, setSavingTopics] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings?.scribeBackend) setBackend(settings.scribeBackend);
    if (settings) setTopicsOn(settings.leaderTopics !== false);
  }, [settings]);

  async function saveTopics(next: boolean) {
    setSavingTopics(true);
    setError("");
    try {
      const res = await api.updateSettings({ leaderTopics: next });
      setTopicsOn(res.leaderTopics !== false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTopics(false);
    }
  }

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
      title="Topics and Scribes"
      description="Every leader groups its quests into Library topics, and a Scribe, a worker in its herd, keeps the topic pages."
      hidden={hidden}
    >
      <SettingsToggle
        label="Library topics for leaders"
        description="On for every leader unless you turn it off for one in its topic panel. Off stops every leader's Scribe, to save its tokens."
        checked={topicsOn}
        disabled={savingTopics}
        onChange={(next) => void saveTopics(next)}
      />
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
