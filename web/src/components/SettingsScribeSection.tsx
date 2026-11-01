import { useEffect, useState } from "react";
import { api, type AppSettings } from "../api.js";
import {
  DEFAULT_SCRIBE_CONTEXT_LIMIT_TOKENS,
  MAX_SCRIBE_CONTEXT_LIMIT_TOKENS,
  MIN_SCRIBE_CONTEXT_LIMIT_TOKENS,
} from "../../shared/scribe-context-limit.js";
import { NumberStepper, SettingsRow, SettingsSubsection } from "./settings-controls.js";

type ScribeBackend = NonNullable<AppSettings["scribeBackend"]>;

/**
 * Settings of leaders' Scribes, the workers that keep their topic pages (every leader has topics):
 * which backend runs them, and the context limit that bounds what their turns cost. The default
 * backend matches each leader's own, so users with only one backend can use topics; a backend
 * change applies to Scribes started afterwards.
 */
export function SettingsScribeSection({
  settings,
  hidden = false,
}: {
  settings: AppSettings | null;
  hidden?: boolean;
}) {
  const [backend, setBackend] = useState<ScribeBackend>("leader");
  const [contextLimit, setContextLimit] = useState(DEFAULT_SCRIBE_CONTEXT_LIMIT_TOKENS);
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings?.scribeBackend) setBackend(settings.scribeBackend);
    if (settings?.scribeContextLimitTokens) setContextLimit(settings.scribeContextLimitTokens);
  }, [settings]);

  async function save(patch: { scribeBackend?: ScribeBackend; scribeContextLimitTokens?: number }) {
    const previous = { backend, contextLimit };
    if (patch.scribeBackend) setBackend(patch.scribeBackend);
    if (patch.scribeContextLimitTokens) setContextLimit(patch.scribeContextLimitTokens);
    setError("");
    try {
      const res = await api.updateSettings(patch);
      setBackend(res.scribeBackend ?? "leader");
      setContextLimit(res.scribeContextLimitTokens ?? DEFAULT_SCRIBE_CONTEXT_LIMIT_TOKENS);
    } catch (err: unknown) {
      setBackend(previous.backend);
      setContextLimit(previous.contextLimit);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsSubsection
      title="Topics and Scribes"
      description="Every leader groups its quests into Library topics, and a Scribe, a worker in its herd, keeps the topic pages."
      hidden={hidden}
    >
      <SettingsRow label="Scribe backend" htmlFor="scribe-backend">
        <select
          id="scribe-backend"
          value={backend}
          onChange={(event) => void save({ scribeBackend: event.target.value as ScribeBackend })}
          className="w-full px-3 py-2 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
        >
          <option value="leader">Same as the leader (default)</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </SettingsRow>
      <SettingsRow
        label="Scribe context limit"
        htmlFor="scribe-context-limit"
        description={`A Scribe keeps running and compacts its conversation before it grows past this, which keeps each update cheap. A change restarts running Scribes at once, a busy one when it finishes its turn; their conversations continue. Default ${DEFAULT_SCRIBE_CONTEXT_LIMIT_TOKENS / 1000}K.`}
      >
        <NumberStepper
          id="scribe-context-limit"
          label="Scribe context limit"
          value={contextLimit / 1000}
          step={32}
          min={MIN_SCRIBE_CONTEXT_LIMIT_TOKENS / 1000}
          max={MAX_SCRIBE_CONTEXT_LIMIT_TOKENS / 1000}
          suffix="K"
          onChange={(next) => void save({ scribeContextLimitTokens: next * 1000 })}
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
