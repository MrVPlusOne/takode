import { useSyncExternalStore } from "react";

/** Which agent CLIs a machine runs; empty values mean `claude` / `codex` on that machine's PATH. */
export interface MachineSettings {
  claudeBinary: string;
  codexBinary: string;
}

/** A registered remote host and its link status, as `GET /api/hosts` reports it. */
export interface RemoteHost {
  id: string;
  name: string;
  createdAt: number;
  online: boolean;
  lastSeenAt: number | null;
  /** Processes the server runs on the host, including ones waiting for it. */
  processes: number;
  /** Git commit the host's `takode node` runs; null when unknown. */
  build: string | null;
  /** The host runs a different (or unknown) Takode build than this server. */
  buildMismatch: boolean;
  /** The server may update the host to its own commit (`takode node --auto-update`). */
  autoUpdate: boolean;
  /** An update was sent to the host and it has not reported a failure. */
  updating: boolean;
  /** Why the host's last update attempt failed. */
  updateError: string | null;
  settings: MachineSettings;
  /** Programs the host's `takode node` was started with (`--claude`, `--codex`); they win over `settings`. */
  commandOverrides: { claude?: string; codex?: string };
}

/** The server's own machine, which runs sessions that have no host. */
export interface LocalHost {
  id: string;
  /** The machine's own name, which stays with it if another machine becomes the server. */
  name: string;
  settings: MachineSettings;
  /**
   * This machine's own `takode node`: when enabled, it runs these sessions so
   * they outlive server restarts. Carries the same link status as a remote host.
   */
  node: Omit<RemoteHost, "id" | "name" | "createdAt" | "settings" | "commandOverrides"> & { enabled: boolean };
}

const POLL_MS = 10_000;

/** `loaded` stays false until the first answer, so callers can tell "none" from "not yet known". */
interface RemoteHostsState {
  hosts: RemoteHost[];
  loaded: boolean;
  serverBuild: string | null;
  local: LocalHost | null;
}

let state: RemoteHostsState = { hosts: [], loaded: false, serverBuild: null, local: null };
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/**
 * Registered remote hosts with their online status, refreshed while any
 * component uses them. The server owns host state; this only mirrors it.
 */
export function useRemoteHosts(): RemoteHostsState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Refresh the shared host list now, e.g. after adding or removing a host. */
export async function refreshRemoteHosts(): Promise<void> {
  try {
    const response = await fetch("/api/hosts");
    if (!response.ok) return;
    const body = (await response.json()) as { hosts: RemoteHost[]; build?: string | null; local?: LocalHost };
    state = { hosts: body.hosts, loaded: true, serverBuild: body.build ?? null, local: body.local ?? null };
    for (const listener of listeners) listener();
  } catch {
    // Keep the last known list while the server is unreachable.
  }
}

/**
 * One line describing a host whose Takode build differs from this server's,
 * and what auto-update is doing about it; null when the builds match.
 */
export function hostBuildWarning(
  host: Pick<RemoteHost, "build" | "buildMismatch" | "autoUpdate" | "updating" | "updateError">,
  serverBuild: string | null,
): string | null {
  if (!host.buildMismatch) return null;
  const mismatch = host.build
    ? `Runs Takode ${shortCommit(host.build)}, this server runs ${serverBuild ? shortCommit(serverBuild) : "another build"}.`
    : "Its Takode build is unknown (an older takode node, or not a Git checkout).";
  if (!host.autoUpdate) return `${mismatch} Update takode on the host, or start it with --auto-update.`;
  if (host.updateError) return `${mismatch} Auto-update failed: ${host.updateError}`;
  if (host.updating) return `${mismatch} Updating now.`;
  return `${mismatch} It updates when none of its sessions is in a turn.`;
}

function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

/** Change a machine's settings (`local` for this machine); a connected host receives them at once. */
export async function updateMachineSettings(id: string, patch: Partial<MachineSettings>): Promise<MachineSettings> {
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = (await response.json().catch(() => ({}))) as { settings?: MachineSettings; error?: string };
  if (!response.ok || !body.settings) throw new Error(body.error || `HTTP ${response.status}`);
  await refreshRemoteHosts();
  return body.settings;
}

/** Turn running this machine's sessions under its own node on or off. */
export async function setLocalNodeEnabled(enabled: boolean): Promise<void> {
  const response = await fetch("/api/hosts/local/node", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  await refreshRemoteHosts();
}

/** Rename a machine (`local` for this one); a host must be online to receive its new name. */
export async function renameMachine(id: string, name: string): Promise<void> {
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  await refreshRemoteHosts();
}

/** Register a host; its token is returned only this once. */
export async function registerRemoteHost(name: string): Promise<{ host: RemoteHost; token: string }> {
  const response = await fetch("/api/hosts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await response.json().catch(() => ({}))) as { host?: RemoteHost; token?: string; error?: string };
  if (!response.ok || !body.host || !body.token) throw new Error(body.error || `HTTP ${response.status}`);
  await refreshRemoteHosts();
  return { host: body.host, token: body.token };
}

/** Remove a host; its token stops working at once. */
export async function removeRemoteHost(id: string): Promise<void> {
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  await refreshRemoteHosts();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (subscribers++ === 0) {
    void refreshRemoteHosts();
    timer = setInterval(() => void refreshRemoteHosts(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (--subscribers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
