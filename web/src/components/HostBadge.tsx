import { useStore } from "../store.js";
import { hostBuildWarning, useRemoteHosts } from "../remote-hosts.js";

/**
 * Sidebar chip naming the remote host a session runs on: muted while it is
 * offline, in warning colors while it runs another Takode build than this server.
 */
export function HostBadge({ hostId }: { hostId: string }) {
  const { hosts, serverBuild } = useRemoteHosts();
  const host = hosts.find((candidate) => candidate.id === hostId);
  const online = host?.online ?? false;
  const buildWarning = online && host ? hostBuildWarning(host, serverBuild) : null;
  return (
    <span
      data-testid="session-host-badge"
      className={`text-[9px] font-medium px-1.5 rounded-full leading-[16px] shrink-0 ${
        !online
          ? "text-cc-muted bg-cc-muted/10"
          : buildWarning
            ? "text-cc-warning bg-cc-warning/10"
            : "text-cc-info bg-cc-info-bg"
      }`}
      title={
        !online
          ? `Runs on ${host?.name ?? "a removed host"}, which is offline; the session continues when it reconnects`
          : buildWarning
            ? `Runs on ${host?.name}. ${buildWarning}`
            : `Runs on ${host?.name}`
      }
    >
      {host?.name ?? "remote"}
    </span>
  );
}

/**
 * Explains why a session on a remote host is not progressing: its host is
 * offline. The server keeps the session's processes and queued input; it
 * continues when the host reconnects.
 */
export function HostOfflineBanner({ sessionId }: { sessionId: string }) {
  const hostId = useStore((state) => state.sdkSessions.find((sdk) => sdk.sessionId === sessionId)?.hostId);
  const { hosts, loaded } = useRemoteHosts();
  const host = hosts.find((candidate) => candidate.id === hostId);
  if (!hostId || !loaded || host?.online) return null;
  return <HostOfflineNotice hostName={host?.name ?? null} />;
}

/** The offline notice itself; `hostName` is null when the host is no longer registered. */
export function HostOfflineNotice({ hostName }: { hostName: string | null }) {
  return (
    <div
      data-testid="host-offline-banner"
      role="status"
      aria-live="polite"
      className="shrink-0 border-t border-cc-warning/25 bg-cc-warning/10 px-3 py-2 sm:px-4"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-center">
        <span className="h-2 w-2 shrink-0 rounded-full bg-cc-warning" aria-hidden="true" />
        <span className="min-w-0 text-xs font-medium text-cc-warning">
          {hostName
            ? `${hostName} is offline. This session waits and continues when the host reconnects.`
            : "This session's host is no longer registered."}
        </span>
      </div>
    </div>
  );
}
