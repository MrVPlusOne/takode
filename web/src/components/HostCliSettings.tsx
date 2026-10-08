import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { updateMachineSettings, type MachineSettings } from "../remote-hosts.js";

type Program = "claude" | "codex";

const PROGRAMS: Array<{ program: Program; label: string; field: keyof MachineSettings }> = [
  { program: "claude", label: "Claude Code", field: "claudeBinary" },
  { program: "codex", label: "Codex", field: "codexBinary" },
];

/**
 * The Claude Code and Codex programs one machine runs. Each value is saved
 * when the field loses focus; new sessions on the machine use it at once and
 * running ones on their next relaunch. `local` adds a Test button, which
 * checks the program on this server's machine.
 */
export function HostCliSettings({
  hostId,
  settings,
  overrides = {},
  local = false,
}: {
  hostId: string;
  settings: MachineSettings;
  /** Programs the host's `takode node` was started with, which win over these settings. */
  overrides?: { claude?: string; codex?: string };
  local?: boolean;
}) {
  return (
    <div className="mt-2 space-y-2" data-testid={`host-cli-settings-${hostId}`}>
      {PROGRAMS.map(({ program, label, field }) => (
        <ProgramField
          key={program}
          hostId={hostId}
          program={program}
          label={label}
          field={field}
          value={settings[field]}
          override={overrides[program]}
          local={local}
        />
      ))}
    </div>
  );
}

function ProgramField({
  hostId,
  program,
  label,
  field,
  value,
  override,
  local,
}: {
  hostId: string;
  program: Program;
  label: string;
  field: keyof MachineSettings;
  value: string;
  override: string | undefined;
  local: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [test, setTest] = useState<{ ok: boolean; resolvedPath?: string; version?: string; error?: string } | null>(
    null,
  );
  const focused = useRef(false);
  const inputId = `${hostId}-${program}-binary`;

  // The host list refreshes in the background; keep what the user is typing.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  async function save() {
    focused.current = false;
    if (draft.trim() === value) return;
    setSaving(true);
    setError("");
    try {
      const saved = await updateMachineSettings(hostId, { [field]: draft.trim() });
      setDraft(saved[field]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTest(null);
    try {
      setTest(await api.testBinary(draft.trim() || program));
    } catch (cause) {
      setTest({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-cc-fg mb-1" htmlFor={inputId}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          value={draft}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder={`${program} (from PATH)`}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-md text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60 font-mono"
        />
        {local && (
          <button
            type="button"
            onClick={() => void runTest()}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
          >
            Test
          </button>
        )}
      </div>
      {override && (
        <p className="mt-1 text-[11px] text-cc-warning" data-testid={`host-${program}-override`}>
          Runs <span className="font-mono-code">{override}</span>: takode node was started with --{program}, which
          overrides this setting.
        </p>
      )}
      {test && (
        <p className={`mt-1 text-[11px] ${test.ok ? "text-cc-success" : "text-cc-error"}`}>
          {test.ok ? `${test.resolvedPath} · ${test.version}` : test.error}
        </p>
      )}
      {saving && <p className="mt-1 text-[11px] text-cc-muted">Saving...</p>}
      {error && <p className="mt-1 text-[11px] text-cc-error">{error}</p>}
    </div>
  );
}
