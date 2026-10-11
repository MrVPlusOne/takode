import { useEffect, useState } from "react";
import { useRemoteHosts } from "../remote-hosts.js";
import {
  describeImport,
  importUserContent,
  pendingApprovals,
  takeOverUserContent,
  takeUserContentFocusRequest,
  USER_CONTENT_FOCUS_EVENT,
  useUserContentStatus,
  type UserContentMachineStatus,
} from "../user-content.js";
import { SettingsSubsection } from "./settings-controls.js";

const BUTTON =
  "px-2.5 py-1 rounded-md text-xs font-medium border border-cc-border text-cc-fg hover:bg-cc-hover disabled:opacity-50";

/** Anchor the one-time notice scrolls to. */
export const USER_CONTENT_SECTION_ID = "settings-user-content";

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
  /** Highlighted briefly after the one-time notice brought the user here. */
  const [focused, setFocused] = useState(false);
  const loaded = status !== null;

  // Scroll once the section has its content, so later layout changes on the page cannot move it out of view.
  useEffect(() => {
    if (!loaded) return;
    let again: ReturnType<typeof setTimeout> | undefined;
    let unhighlight: ReturnType<typeof setTimeout> | undefined;
    const focus = () => {
      if (!takeUserContentFocusRequest()) return;
      const scroll = () => document.getElementById(USER_CONTENT_SECTION_ID)?.scrollIntoView({ block: "start" });
      scroll();
      setFocused(true);
      again = setTimeout(scroll, 400);
      unhighlight = setTimeout(() => setFocused(false), 4000);
    };
    focus();
    window.addEventListener(USER_CONTENT_FOCUS_EVENT, focus);
    return () => {
      window.removeEventListener(USER_CONTENT_FOCUS_EVENT, focus);
      clearTimeout(again);
      clearTimeout(unhighlight);
    };
  }, [loaded]);

  const machineName = (hostId: string | null) =>
    hostId === null
      ? `${local?.name ?? "This machine"} (this machine)`
      : (hosts.find((host) => host.id === hostId)?.name ?? hostId);

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
    <div
      id={USER_CONTENT_SECTION_ID}
      className={`scroll-mt-28 rounded-lg transition-shadow ${focused ? "ring-2 ring-cc-primary/60" : ""}`}
    >
      <SettingsSubsection
        title="Your Instructions and Skills"
        description="Kept once on this server's machine and delivered to every machine's ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md and skill folders, so every session reads the same copy. Files you made yourself are replaced only after you approve here (identical ones need no approval), and every replaced file is backed up on its machine."
        hidden={hidden}
      >
        {status && (
          <div className="space-y-2 text-xs">
            <div className="text-cc-muted">
              Instructions: <span className="font-mono">{status.store.instructions}</span> (all.md, claude.md,
              codex.md). Skills: <span className="font-mono">{status.store.skills}</span> (all, claude, codex).
            </div>
            {status.storeEmpty ? (
              <div className="space-y-1.5">
                <div className="text-cc-fg">
                  Not set up yet. Import copies one machine's instruction files and skills into the store, then lets
                  Takode manage that machine's files. Other machines stay as they are until you approve each.
                </div>
                {status.importCandidates.map(({ hostId, summary, error: candidateError, pending }) => {
                  const key = `import:${hostId ?? ""}`;
                  return (
                    <div key={key} className="rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2 space-y-1">
                      <div className="text-cc-fg font-medium">{machineName(hostId)}</div>
                      <div className="text-cc-muted">
                        {summary
                          ? describeImport(summary)
                          : pending
                            ? "Reading this machine's instructions and skills…"
                            : `Could not read it: ${candidateError}`}
                      </div>
                      {summary && (
                        <button
                          type="button"
                          className={BUTTON}
                          disabled={busy}
                          onClick={() => act(key, () => importUserContent(hostId))}
                        >
                          {confirming === key ? `Confirm import from ${machineName(hostId)}` : "Import from here"}
                        </button>
                      )}
                    </div>
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
    </div>
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
          <ul className="list-disc pl-4 text-cc-muted">
            {pending.map((entry) => (
              <li key={entry.path}>
                <span className="font-mono">{entry.path}</span>
                {entry.detail && <span>: {entry.detail}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className={BUTTON} disabled={busy} onClick={onTakeOver}>
            {confirming ? "Confirm: replace with the store's copy" : "Let Takode manage these"}
          </button>
        </>
      )}
      {machine.lastBackup && (
        <div className="text-cc-muted">
          Replaced files were backed up on this machine to <span className="font-mono">{machine.lastBackup.dir}</span>
        </div>
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
