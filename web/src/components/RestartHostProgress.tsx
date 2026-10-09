import { hostRestartProgress, useRemoteHosts, type HostRestartProgress } from "../remote-hosts.js";

const STATE_STYLE: Record<HostRestartProgress["state"], { mark: string; className: string }> = {
  done: { mark: "✓", className: "text-cc-success" },
  updating: { mark: "…", className: "text-cc-primary" },
  waiting: { mark: "…", className: "text-cc-muted" },
  failed: { mark: "!", className: "text-cc-error" },
  offline: { mark: "–", className: "text-cc-muted" },
  manual: { mark: "!", className: "text-cc-warning" },
};

/**
 * After a Restart Server from this tab: each machine moving its sessions onto
 * the new build. The hosts update after the server is back, so this follows
 * the restart notice rather than the full-screen progress card, which closes
 * when the page reloads.
 */
export function RestartHostProgress() {
  const hosts = useRemoteHosts();
  const rows = hostRestartProgress(hosts);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-cc-border px-3 py-2" data-testid="restart-host-progress">
      <p className="text-xs font-medium text-cc-fg">Hosts</p>
      <ul className="mt-1 space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-baseline gap-2 text-xs" data-state={row.state}>
            <span className={`w-3 shrink-0 text-center ${STATE_STYLE[row.state].className}`} aria-hidden="true">
              {STATE_STYLE[row.state].mark}
            </span>
            <span className="min-w-0 break-words">
              <span className="text-cc-fg">{row.name}</span>{" "}
              <span className={STATE_STYLE[row.state].className}>{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
