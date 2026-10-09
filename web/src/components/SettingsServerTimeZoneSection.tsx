import { useEffect, useState } from "react";
import { api, type AppSettings } from "../api.js";
import { SettingsSubsection } from "./settings-controls.js";

type ServerTimeZoneSettings = Pick<AppSettings, "serverTimeZone" | "serverTimeZoneInEffect" | "serverTimeZoneDefault">;

const TIME_ZONE_OPTIONS = Intl.supportedValuesOf("timeZone");

/**
 * The zone the server formats times in. The server applies it when it starts,
 * so a change shows as pending until the next restart.
 */
export function SettingsServerTimeZoneSection({
  initial,
  hidden = false,
}: {
  /** Loaded settings; null until the page has them. */
  initial: ServerTimeZoneSettings | null;
  hidden?: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(initial?.serverTimeZone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCurrent(initial);
    setDraft(initial?.serverTimeZone ?? "");
  }, [initial]);

  async function save() {
    if (!current || draft.trim() === current.serverTimeZone) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.updateSettings({ serverTimeZone: draft.trim() });
      setCurrent(res);
      setDraft(res.serverTimeZone);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const nextZone = current ? current.serverTimeZone || current.serverTimeZoneDefault : "";

  return (
    <SettingsSubsection
      title="Time Zone"
      description="The zone the server shows times in, such as chat source tags, herd events and timers. Leave empty to use the machine's zone."
      hidden={hidden}
    >
      <div>
        <div className="flex gap-2">
          <input
            id="server-time-zone"
            type="text"
            aria-label="Server Time Zone"
            list="server-time-zone-options"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
            }}
            className="flex-1 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60 font-mono"
            placeholder={current?.serverTimeZoneDefault}
          />
          <datalist id="server-time-zone-options">
            {TIME_ZONE_OPTIONS.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              saving
                ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                : "bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
            }`}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {current && (
          <p className="mt-1.5 text-xs text-cc-muted">
            In effect: <span className="font-mono">{current.serverTimeZoneInEffect}</span>.
            {nextZone !== current.serverTimeZoneInEffect && (
              <>
                {" "}
                Restart the server to switch to <span className="font-mono">{nextZone}</span>.
              </>
            )}
          </p>
        )}
        {error && <p className="mt-1.5 text-xs text-cc-error">{error}</p>}
      </div>
    </SettingsSubsection>
  );
}
