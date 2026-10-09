import { useState, type ReactNode } from "react";
import { HostCliSettings } from "./HostCliSettings.js";
import {
  hostBuildWarning,
  registerRemoteHost,
  removeRemoteHost,
  renameMachine,
  useRemoteHosts,
  type LocalHost,
  type RemoteHost,
} from "../remote-hosts.js";

const HOST_CARD = "rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2 text-xs";

/**
 * Machines that run sessions for this server: this server's own machine, and
 * remote hosts that each run `takode node`, which connects out to this server
 * with the token issued here. Every machine has its own name, which stays with
 * it if another machine becomes the server, and its own Claude Code and Codex
 * settings.
 */
export function SettingsHostsSection() {
  const { hosts, serverBuild, local } = useRemoteHosts();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<{ name: string; token: string; hostPort: number } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function onAdd() {
    void run(async () => {
      const { host, token, hostPort } = await registerRemoteHost(name.trim());
      setAdded({ name: host.name, token, hostPort });
      setName("");
    });
  }

  function onRemove(host: RemoteHost) {
    if (confirmingRemove !== host.id) {
      setConfirmingRemove(host.id);
      return;
    }
    setConfirmingRemove(null);
    void run(() => removeRemoteHost(host.id));
  }

  return (
    <>
      <ul className="space-y-2" data-testid="settings-hosts-list">
        {local && (
          <li className={HOST_CARD} data-testid="settings-local-host">
            <MachineName id={local.id} name={local.name} />
            <div className="mt-0.5 text-cc-muted">
              Runs this Takode server and the sessions that have no other host.
            </div>
            <div className="mt-0.5 text-cc-muted" data-testid="settings-local-node">
              {localNodeDescription(local.node, serverBuild)}
            </div>
            <HostCliSettings hostId={local.id} settings={local.settings} local />
          </li>
        )}
        {hosts.map((host) => (
          <li key={host.id} className={HOST_CARD}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <MachineName
                  id={host.id}
                  name={host.name}
                  disabledReason={host.online ? undefined : "Connect the host to rename it"}
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${host.online ? "bg-cc-success" : "bg-cc-muted/50"}`}
                  />
                </MachineName>
                <div className="mt-0.5 text-cc-muted">
                  {host.online ? "Online" : "Offline"} · {host.processes} process{host.processes === 1 ? "" : "es"}
                  {host.lastSeenAt
                    ? ` · last seen ${new Date(host.lastSeenAt).toLocaleString()}`
                    : " · never connected"}
                  {host.build && !host.buildMismatch ? ` · Takode ${host.build.slice(0, 8)}` : ""}
                  {host.autoUpdate && !host.buildMismatch ? " · auto-update on" : ""}
                </div>
                <HostBuildWarning host={host} serverBuild={serverBuild} />
              </div>
              <button
                type="button"
                onClick={() => onRemove(host)}
                disabled={busy}
                className="shrink-0 px-2.5 py-1 rounded text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer disabled:cursor-not-allowed disabled:text-cc-muted"
              >
                {confirmingRemove === host.id ? "Confirm remove" : "Remove"}
              </button>
            </div>
            <HostCliSettings hostId={host.id} settings={host.settings} overrides={host.commandOverrides} />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Host name, e.g. devbox"
          aria-label="New host name"
          className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-cc-input-bg border border-cc-border text-sm text-cc-fg focus:outline-none focus:border-cc-primary/60"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={busy || !name.trim()}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer disabled:cursor-not-allowed disabled:bg-cc-hover disabled:text-cc-muted"
        >
          Add host
        </button>
      </div>

      {error && <p className="text-xs text-cc-error">{error}</p>}

      {added && (
        <div className="space-y-2 rounded-lg border border-cc-border bg-cc-hover/30 px-3 py-3 text-xs">
          <p className="text-cc-fg">
            Registered <span className="font-medium">{added.name}</span>. Its token is shown only now. On that machine,
            save it to a file only you can read, then start the helper from a Takode checkout:
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-cc-bg px-2 py-1.5 font-mono-code text-[11px] text-cc-fg">
            {`umask 077 && printf '%s' '${added.token}' > ~/.takode-host-token\n` +
              `bun web/bin/takode-node.ts --coordinator <address> --token-file ~/.takode-host-token`}
          </pre>
          <p className="text-cc-muted">
            Replace &lt;address&gt; with one that reaches this server's host port {added.hostPort}, not the page's port:
            for example http://127.0.0.1:13456 through a tunnel such as ssh -R 13456:127.0.0.1:{added.hostPort}{" "}
            &lt;host&gt;, or an https address that leads there. Addresses other than the host's own loopback need https.
            Add --auto-update to let this server switch the host's checkout to its own commit, with a frozen install and
            restart, whenever none of the host's sessions is in a turn. A machine that already has a name from another
            Takode setup keeps it.
          </p>
          <button
            type="button"
            onClick={() => setAdded(null)}
            className="px-2.5 py-1 rounded text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
          >
            Done
          </button>
        </div>
      )}
    </>
  );
}

const SMALL_BUTTON =
  "shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer disabled:cursor-not-allowed disabled:text-cc-muted";

/**
 * A machine's name with an inline rename. The machine keeps its name itself,
 * so a host can only be renamed while it is connected (`disabledReason`).
 */
function MachineName({
  id,
  name,
  disabledReason,
  children,
}: {
  id: string;
  name: string;
  disabledReason?: string;
  /** Shown before the name, e.g. an online dot. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (draft === null) return;
    setSaving(true);
    setError("");
    try {
      await renameMachine(id, draft.trim());
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 font-medium text-cc-fg">
        {children}
        <span className="truncate">{name}</span>
        <button
          type="button"
          onClick={() => setDraft(name)}
          disabled={Boolean(disabledReason)}
          title={disabledReason}
          className={SMALL_BUTTON}
        >
          Rename
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center gap-1.5">
        {children}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") setDraft(null);
          }}
          aria-label={`New name for ${name}`}
          autoFocus
          className="min-w-0 flex-1 px-2 py-0.5 rounded bg-cc-input-bg border border-cc-border text-xs text-cc-fg focus:outline-none focus:border-cc-primary/60"
        />
        <button type="button" onClick={() => void save()} disabled={saving || !draft.trim()} className={SMALL_BUTTON}>
          Save
        </button>
        <button type="button" onClick={() => setDraft(null)} disabled={saving} className={SMALL_BUTTON}>
          Cancel
        </button>
      </div>
      {error && <p className="text-cc-error">{error}</p>}
    </div>
  );
}

/** The host's build differs from this server's: say so, and what auto-update is doing about it. */
function HostBuildWarning({ host, serverBuild }: { host: RemoteHost; serverBuild: string | null }) {
  const warning = hostBuildWarning(host, serverBuild);
  if (!warning) return null;
  return (
    <div
      data-testid="host-build-warning"
      className={`mt-0.5 ${host.updateError ? "text-cc-error" : "text-cc-warning"}`}
    >
      {warning}
    </div>
  );
}

/** What this machine's node does, and how it is doing. */
function localNodeDescription(node: LocalHost["node"], serverBuild: string | null): string {
  const purpose = "Its sessions run under a takode node, so a server restart does not interrupt them.";
  const status = node.online
    ? `Node connected · ${node.processes} process${node.processes === 1 ? "" : "es"}`
    : "Node starting";
  const warning = hostBuildWarning(node, serverBuild);
  return `${purpose} ${status}.${warning ? ` ${warning}` : ""}`;
}
