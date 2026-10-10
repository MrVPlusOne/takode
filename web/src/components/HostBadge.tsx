import { useStore } from "../store.js";
import { hostBuildWarning, useRemoteHosts, type RemoteHost } from "../remote-hosts.js";
import { timeAgo } from "../utils/quest-helpers.js";

type HostState = "online" | "offline" | "build-mismatch";

/** How a session's host is doing; `host` is undefined when it is no longer registered. */
function describeHost(
  host: RemoteHost | undefined,
  serverBuild: string | null,
): { name: string; state: HostState; detail: string } {
  if (!host) return { name: "a removed host", state: "offline", detail: "It is no longer registered." };
  if (!host.online) {
    const lastSeen = host.lastSeenAt ? `, last seen ${timeAgo(host.lastSeenAt)}` : "";
    return {
      name: host.name,
      state: "offline",
      detail: `Offline${lastSeen}. The session continues when the host reconnects.`,
    };
  }
  const buildWarning = hostBuildWarning(host, serverBuild);
  if (buildWarning) return { name: host.name, state: "build-mismatch", detail: buildWarning };
  return { name: host.name, state: "online", detail: "Online" };
}

/** Host state is not encoded in color: every chip is neutral, and only an unreachable host gets a mark. */
const CHIP_TONE = "text-cc-muted bg-cc-muted/10";

function UnpluggedIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0"
      aria-hidden="true"
      data-testid="session-host-offline-icon"
    >
      <path d="M6 1.5v3M10 1.5v3M4.5 4.5h7V7a3.5 3.5 0 01-7 0V4.5zM8 10.5v4M2 2l12 12" />
    </svg>
  );
}

function ServerIcon({ phoneOnly }: { phoneOnly: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`h-2.5 w-2.5 shrink-0 ${phoneOnly ? "sm:hidden" : ""}`}
      aria-hidden="true"
    >
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm9.5 2a.75.75 0 100-1.5.75.75 0 000 1.5zM2 10a1 1 0 011-1h10a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zm9.5 2a.75.75 0 100-1.5.75.75 0 000 1.5z" />
    </svg>
  );
}

/**
 * Chip naming the remote host a session runs on. Every chip uses the same
 * neutral style; a host the session cannot reach (offline or no longer
 * registered) gets an unplugged icon instead of an "offline" label, and the
 * tooltip and screen-reader text explain it. A host on another Takode build
 * says so in its tooltip and in the session info panel. Long host names
 * truncate. `iconOnPhone` shrinks the chip to its icon below the `sm`
 * breakpoint, for rows such as the top bar where the name would crowd out the
 * session title.
 */
export function HostChip({
  host,
  serverBuild,
  iconOnPhone = false,
}: {
  host: RemoteHost | undefined;
  serverBuild: string | null;
  iconOnPhone?: boolean;
}) {
  const { name, state, detail } = describeHost(host, serverBuild);
  const label = host?.name ?? "remote";
  const offline = state === "offline";
  return (
    <span
      data-testid="session-host-badge"
      data-host-state={state}
      className={`inline-flex min-w-0 max-w-[5rem] sm:max-w-[8rem] shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[9px] font-medium leading-[16px] ${iconOnPhone ? "max-sm:px-1" : ""} ${CHIP_TONE}`}
      title={`Runs on ${name}. ${detail}`}
    >
      {offline ? <UnpluggedIcon /> : iconOnPhone && <ServerIcon phoneOnly />}
      <span className={`truncate ${iconOnPhone ? "max-sm:sr-only" : ""}`}>{label}</span>
      {offline && <span className="sr-only">{host ? " (offline)" : " (no longer registered)"}</span>}
    </span>
  );
}

/** Host chip for a known host id, kept current from the server's host list. */
export function HostBadge({ hostId, iconOnPhone }: { hostId: string; iconOnPhone?: boolean }) {
  const { hosts, serverBuild } = useRemoteHosts();
  return (
    <HostChip
      host={hosts.find((candidate) => candidate.id === hostId)}
      serverBuild={serverBuild}
      iconOnPhone={iconOnPhone}
    />
  );
}

/** Host chip for a session; renders nothing for sessions on this server's machine. */
export function SessionHostBadge({ sessionId, iconOnPhone }: { sessionId: string; iconOnPhone?: boolean }) {
  const hostId = useSessionHostId(sessionId);
  return hostId ? <HostBadge hostId={hostId} iconOnPhone={iconOnPhone} /> : null;
}

/**
 * Session info panel row saying which machine runs the session. Local sessions
 * are labeled only while some session runs on a remote host, when the
 * distinction matters; they never start host polling.
 */
export function SessionMachineRow({ sessionId }: { sessionId: string }) {
  const hostId = useSessionHostId(sessionId);
  const anyRemoteSession = useStore((state) => state.sdkSessions.some((sdk) => !!sdk.hostId && !sdk.archived));
  if (hostId) return <RemoteMachineRow hostId={hostId} />;
  return anyRemoteSession ? <SessionMachineSummary host={undefined} serverBuild={null} /> : null;
}

function RemoteMachineRow({ hostId }: { hostId: string }) {
  const { hosts, loaded, serverBuild } = useRemoteHosts();
  // Until the host list arrives, a missing host would wrongly read as removed.
  if (!loaded) return null;
  return (
    <SessionMachineSummary
      host={hosts.find((candidate) => candidate.id === hostId) ?? null}
      serverBuild={serverBuild}
    />
  );
}

/**
 * The machine row itself. `host` is undefined for a session on this server's
 * machine and null for one whose host is no longer registered.
 */
export function SessionMachineSummary({
  host,
  serverBuild,
}: {
  host: RemoteHost | null | undefined;
  serverBuild: string | null;
}) {
  const remote = host !== undefined;
  const { state, detail } = describeHost(host ?? undefined, serverBuild);
  return (
    <div data-testid="session-info-machine" className="flex min-w-0 items-start gap-1.5 text-[11px] leading-[16px]">
      <span className="shrink-0 text-cc-muted/60">Runs on</span>
      {remote ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <HostChip host={host ?? undefined} serverBuild={serverBuild} />
          <span
            data-testid="session-info-machine-status"
            className={state === "build-mismatch" ? "text-cc-warning" : "text-cc-muted"}
          >
            {detail}
          </span>
        </span>
      ) : (
        <span data-testid="session-info-machine-status" className="text-cc-muted">
          This server's machine
        </span>
      )}
    </div>
  );
}

function useSessionHostId(sessionId: string): string | null | undefined {
  return useStore((state) => state.sdkSessions.find((sdk) => sdk.sessionId === sessionId)?.hostId);
}

/**
 * Explains why a session on a remote host is not progressing: its host is
 * offline. The server keeps the session's processes and queued input; it
 * continues when the host reconnects.
 */
export function HostOfflineBanner({ sessionId }: { sessionId: string }) {
  const hostId = useSessionHostId(sessionId);
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
