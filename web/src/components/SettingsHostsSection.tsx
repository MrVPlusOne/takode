import { useState } from "react";
import { registerRemoteHost, removeRemoteHost, useRemoteHosts, type RemoteHost } from "../remote-hosts.js";

/**
 * Machines that run sessions for this server. Each runs `takode node`, which
 * connects out to this server with the token issued here.
 */
export function SettingsHostsSection() {
  const { hosts } = useRemoteHosts();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<{ name: string; token: string } | null>(null);
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
      const { host, token } = await registerRemoteHost(name.trim());
      setAdded({ name: host.name, token });
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
      {hosts.length === 0 ? (
        <p className="text-xs text-cc-muted">No hosts yet. Sessions run on this machine.</p>
      ) : (
        <ul className="space-y-2" data-testid="settings-hosts-list">
          {hosts.map((host) => (
            <li
              key={host.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-cc-fg">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${host.online ? "bg-cc-success" : "bg-cc-muted/50"}`}
                  />
                  <span className="truncate">{host.name}</span>
                </div>
                <div className="mt-0.5 text-cc-muted">
                  {host.online ? "Online" : "Offline"} · {host.processes} process{host.processes === 1 ? "" : "es"}
                  {host.lastSeenAt
                    ? ` · last seen ${new Date(host.lastSeenAt).toLocaleString()}`
                    : " · never connected"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(host)}
                disabled={busy}
                className="shrink-0 px-2.5 py-1 rounded text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer disabled:cursor-not-allowed disabled:text-cc-muted"
              >
                {confirmingRemove === host.id ? "Confirm remove" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

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
              `bun web/bin/takode-node.ts --coordinator ${window.location.origin} --token-file ~/.takode-host-token`}
          </pre>
          <p className="text-cc-muted">
            Use an address of this server that the host can reach. Addresses other than this machine need https.
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
