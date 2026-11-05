import { useEffect, useRef, useState } from "react";
import { updateMachineSettings } from "../remote-hosts.js";
import { SettingsToggle } from "./settings-controls.js";

/**
 * How many sessions one machine keeps running, and, for a Mac, whether it stays
 * awake while its sessions work. Both apply to that machine's own sessions only.
 */
export function HostPowerSettings({
  hostId,
  maxKeepAlive,
  keepAwake,
  platform,
}: {
  hostId: string;
  /** The machine's own limit; undefined uses the server's default. */
  maxKeepAlive: number | undefined;
  keepAwake: boolean;
  /** `process.platform` of the machine; null while a host has not reported it. */
  platform: string | null;
}) {
  return (
    <>
      <KeepAliveField hostId={hostId} value={maxKeepAlive} />
      {platform === "darwin" && <KeepAwakeField hostId={hostId} on={keepAwake} />}
    </>
  );
}

/** The machine's keep-alive limit, saved when the field loses focus; empty returns it to the default. */
function KeepAliveField({ hostId, value }: { hostId: string; value: number | undefined }) {
  const shown = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const focused = useRef(false);
  const inputId = `${hostId}-max-keep-alive`;

  // The host list refreshes in the background; keep what the user is typing.
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  async function save() {
    focused.current = false;
    const text = draft.trim();
    if (text === shown) return;
    const limit = text === "" ? null : Number(text);
    if (limit !== null && !(Number.isInteger(limit) && limit >= 0)) {
      setError("Enter a whole number, 0 for no limit, or leave it empty for the default.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await updateMachineSettings(hostId, { maxKeepAlive: limit });
      setDraft(saved.maxKeepAlive === undefined ? "" : String(saved.maxKeepAlive));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-cc-fg mb-1" htmlFor={inputId}>
        Max Keep-Alive
      </label>
      <input
        id={inputId}
        type="number"
        min={0}
        step={1}
        value={draft}
        placeholder="Default"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-24 px-2.5 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-md text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
      />
      <p className="mt-1 text-[11px] text-cc-muted">
        Sessions that may keep a live process on this machine; its longest-idle ones stop beyond that. Empty uses the
        default under Performance &amp; Power; 0 means no limit.
      </p>
      {saving && <p className="mt-1 text-[11px] text-cc-muted">Saving...</p>}
      {error && <p className="mt-1 text-[11px] text-cc-error">{error}</p>}
    </div>
  );
}

/** Whether this Mac stays awake while one of its sessions is mid-turn. */
function KeepAwakeField({ hostId, on }: { hostId: string; on: boolean }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function change(next: boolean) {
    setSaving(true);
    setError("");
    try {
      await updateMachineSettings(hostId, { keepAwake: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SettingsToggle
        label="Keep this Mac awake during turns"
        description="Stays awake while one of this machine's sessions is mid-turn, and for the grace period under Performance & Power after."
        checked={on}
        onChange={(next) => void change(next)}
        disabled={saving}
      />
      {error && <p className="mt-1 text-[11px] text-cc-error">{error}</p>}
    </div>
  );
}
