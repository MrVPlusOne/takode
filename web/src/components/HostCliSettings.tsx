import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { updateMachineSettings, type MachineSettings } from "../remote-hosts.js";

type Program = "claude" | "codex";

const PROGRAMS: Array<{ program: Program; label: string; field: "claudeBinary" | "codexBinary" }> = [
  { program: "claude", label: "Claude Code", field: "claudeBinary" },
  { program: "codex", label: "Codex", field: "codexBinary" },
];

/**
 * The Claude Code and Codex programs one machine runs, and the folder its
 * session worktrees go in. Each value is saved when the field loses focus; new
 * sessions on the machine use it at once and running ones on their next
 * relaunch. `local` adds a Test button, which checks a program on this
 * server's machine.
 */
export function HostCliSettings({
  hostId,
  settings,
  defaultWorktreeRoot,
  overrides = {},
  local = false,
}: {
  hostId: string;
  settings: MachineSettings;
  /** The machine's own default worktree folder; null while a host has not reported it. */
  defaultWorktreeRoot: string | null;
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
      <WorktreeFolderField hostId={hostId} value={settings.worktreeRoot ?? ""} defaultRoot={defaultWorktreeRoot} />
      <EditorAccessField hostId={hostId} access={settings.editorAccess ?? ""} sshHost={settings.sshHost ?? ""} />
    </div>
  );
}

const EDITOR_ACCESS_OPTIONS: Array<{ value: NonNullable<MachineSettings["editorAccess"]>; label: string }> = [
  { value: "", label: "Not set up" },
  { value: "local", label: "It's my computer" },
  { value: "ssh", label: "Over SSH (Remote-SSH)" },
];

/**
 * How Open in VS Code (or Cursor) reaches this machine's files. Editor links open on the user's
 * own computer, so a file on another machine opens through Remote-SSH by the host name that
 * computer's SSH config knows it by. Until it is set, the button is shown grayed out.
 */
function EditorAccessField({ hostId, access, sshHost }: { hostId: string; access: string; sshHost: string }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const host = useSavedField(hostId, "sshHost", sshHost);
  const selectId = `${hostId}-editor-access`;
  const sshHostInputId = `${hostId}-ssh-host`;

  async function choose(next: string) {
    setSaving(true);
    setError("");
    try {
      await updateMachineSettings(hostId, { editorAccess: next as MachineSettings["editorAccess"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-cc-fg mb-1" htmlFor={selectId}>
        Open its files in your editor
      </label>
      <select
        id={selectId}
        value={access}
        onChange={(event) => void choose(event.target.value)}
        className={`${INPUT_CLASS} font-sans`}
      >
        {EDITOR_ACCESS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {access === "ssh" && (
        <div className="mt-2">
          <label className="block text-xs font-medium text-cc-fg mb-1" htmlFor={sshHostInputId}>
            SSH host
          </label>
          <input id={sshHostInputId} type="text" {...host.inputProps} placeholder="devbox" className={INPUT_CLASS} />
          {host.status}
        </div>
      )}
      <p className="mt-1 text-[11px] text-cc-muted">
        Used by Open in VS Code, which opens files on your own computer. Choose "It's my computer" for the machine your
        browser runs on; for another machine, give the host name your computer's SSH config uses for it, and VS Code
        opens its files through the Remote-SSH extension.
      </p>
      {saving && <p className="mt-1 text-[11px] text-cc-muted">Saving...</p>}
      {error && <p className="mt-1 text-[11px] text-cc-error">{error}</p>}
    </div>
  );
}

/**
 * Where the machine keeps session worktrees. A folder on storage that outlives
 * the machine (a shared file system) keeps uncommitted work when the host is
 * moved to another machine; it only applies to worktrees created from now on.
 * Empty, it shows the machine's real default folder, so a home directory moved
 * elsewhere (such as node-local disk on a cluster) is visible.
 */
function WorktreeFolderField({
  hostId,
  value,
  defaultRoot,
}: {
  hostId: string;
  value: string;
  defaultRoot: string | null;
}) {
  const field = useSavedField(hostId, "worktreeRoot", value);
  const inputId = `${hostId}-worktree-root`;
  return (
    <div>
      <label className="block text-xs font-medium text-cc-fg mb-1" htmlFor={inputId}>
        Worktree folder
      </label>
      <input
        id={inputId}
        type="text"
        {...field.inputProps}
        placeholder={defaultRoot ?? "~/.companion/worktrees"}
        className={INPUT_CLASS}
      />
      <p className="mt-1 text-[11px] text-cc-muted">
        {/* The placeholder is cut off on a phone, so the full default is spelled out here too. */}
        {!field.draft.trim() && (
          <span data-testid={`${hostId}-worktree-root-default`}>
            {defaultRoot ? (
              <>
                Empty uses <span className="font-mono-code break-all text-cc-fg">{defaultRoot}</span>.{" "}
              </>
            ) : (
              <>Empty uses ~/.companion/worktrees in the host's home; its full path shows once the host connects. </>
            )}
          </span>
        )}
        An absolute path on this machine. On storage that outlives the machine, uncommitted work in session worktrees
        survives a move to another machine. Applies to worktrees created from now on.
      </p>
      {field.status}
    </div>
  );
}

const INPUT_CLASS =
  "flex-1 min-w-0 w-full px-2.5 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-md text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60 font-mono";

/** A machine setting edited in a text field and saved when the field loses focus. */
function useSavedField(hostId: string, field: keyof MachineSettings, value: string) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const focused = useRef(false);

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
      setDraft(saved[field] ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return {
    draft,
    inputProps: {
      value: draft,
      onFocus: () => {
        focused.current = true;
      },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
      onBlur: () => void save(),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") event.currentTarget.blur();
      },
    },
    status: (
      <>
        {saving && <p className="mt-1 text-[11px] text-cc-muted">Saving...</p>}
        {error && <p className="mt-1 text-[11px] text-cc-error">{error}</p>}
      </>
    ),
  };
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
  field: "claudeBinary" | "codexBinary";
  value: string;
  override: string | undefined;
  local: boolean;
}) {
  const saved = useSavedField(hostId, field, value);
  const [test, setTest] = useState<{ ok: boolean; resolvedPath?: string; version?: string; error?: string } | null>(
    null,
  );
  const inputId = `${hostId}-${program}-binary`;

  async function runTest() {
    setTest(null);
    try {
      setTest(await api.testBinary(saved.draft.trim() || program));
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
          {...saved.inputProps}
          placeholder={`${program} (from PATH)`}
          className={INPUT_CLASS}
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
      {saved.status}
    </div>
  );
}
