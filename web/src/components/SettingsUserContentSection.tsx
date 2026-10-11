import { useState } from "react";
import { useRemoteHosts } from "../remote-hosts.js";
import {
  importUserContent,
  pendingApprovals,
  takeOverUserContent,
  useUserContentStatus,
  type UserContentMachineStatus,
} from "../user-content.js";
import { SettingsSubsection } from "./settings-controls.js";

const BUTTON =
  "px-2.5 py-1 rounded-md text-xs font-medium border border-cc-border text-cc-fg hover:bg-cc-hover disabled:opacity-50";

/**
 * The user's own instructions and skills, kept once on this server's machine
 * and delivered to every machine's standard Claude Code and Codex places.
 * Takode never replaces a file the user made without approval here.
 */
export function SettingsUserContentSection({ hidden = false }: { hidden?: boolean }) {
  const { status, refresh } = useUserContentStatus();
  const { hosts, local } = useRemoteHosts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The action waiting for a second click, so nothing is replaced on a single tap. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const machineName = (hostId: string | null) =>
    hostId === null
      ? `${local?.name ?? "This machine"} (this machine)`
      : (hosts.find((host) => host.id === hostId)?.name ?? hostId);
  const machines: (string | null)[] = [null, ...hosts.filter((host) => host.online).map((host) => host.id)];

  function act(key: string, action: () => Promise<void>) {
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    setBusy(true);
    setError("");
    action()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        setBusy(false);
        void refresh();
      });
  }

  return (
    <SettingsSubsection
      title="Your Instructions and Skills"
      description="Kept once on this server's machine and delivered to every machine's ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md and skill folders, so every session reads the same copy. Files you made yourself are replaced only after you approve here, and every replaced file is backed up."
      hidden={hidden}
    >
      {status && (
        <div className="space-y-2 text-xs">
          <div className="text-cc-muted">
            Store: <span className="font-mono">{status.storeRoot}</span> (instructions/all.md, claude.md, codex.md;
            skills/all, claude, codex)
          </div>
          {status.storeEmpty ? (
            <div className="space-y-1.5">
              <div className="text-cc-fg">
                Not set up yet. Import copies one machine's instruction files and skills into the store, then lets
                Takode manage that machine's files. Other machines stay as they are until you approve each.
              </div>
              {machines.map((hostId) => {
                const key = `import:${hostId ?? ""}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`${BUTTON} mr-2`}
                    disabled={busy}
                    onClick={() => act(key, () => importUserContent(hostId))}
                  >
                    {confirming === key
                      ? `Confirm import from ${machineName(hostId)}`
                      : `Import from ${machineName(hostId)}`}
                  </button>
                );
              })}
            </div>
          ) : (
            status.machines.map((machine) => (
              <MachineRow
                key={machine.hostId ?? ""}
                machine={machine}
                name={machineName(machine.hostId)}
                busy={busy}
                confirming={confirming === `take-over:${machine.hostId ?? ""}`}
                onTakeOver={() => act(`take-over:${machine.hostId ?? ""}`, () => takeOverUserContent(machine.hostId))}
              />
            ))
          )}
          {error && <div className="text-cc-error">{error}</div>}
        </div>
      )}
    </SettingsSubsection>
  );
}

function MachineRow({
  machine,
  name,
  busy,
  confirming,
  onTakeOver,
}: {
  machine: UserContentMachineStatus;
  name: string;
  busy: boolean;
  confirming: boolean;
  onTakeOver: () => void;
}) {
  const pending = pendingApprovals(machine);
  const shadowed = machine.result?.skills.shadowedByTakode ?? [];
  return (
    <div className="rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2 space-y-1">
      <div className="text-cc-fg font-medium">{name}</div>
      {machine.error && <div className="text-cc-error">Could not deliver: {machine.error}</div>}
      {!machine.error && pending.length === 0 && <div className="text-cc-muted">Up to date</div>}
      {pending.length > 0 && (
        <>
          <div className="text-cc-fg">Waiting for your approval to replace (each is backed up first):</div>
          <ul className="list-disc pl-4 font-mono text-cc-muted">
            {pending.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <button type="button" className={BUTTON} disabled={busy} onClick={onTakeOver}>
            {confirming ? "Confirm: replace with the store's copy" : "Let Takode manage these"}
          </button>
        </>
      )}
      {shadowed.length > 0 && (
        <div className="text-cc-muted">
          Takode's own skill of the same name is used instead of: {shadowed.join(", ")}
        </div>
      )}
      {machine.result?.notes.map((note) => (
        <div key={note} className="text-cc-muted">
          {note}
        </div>
      ))}
    </div>
  );
}
