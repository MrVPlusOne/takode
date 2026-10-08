import { useSyncExternalStore } from "react";

/** A registered remote host and its link status, as `GET /api/hosts` reports it. */
export interface RemoteHost {
  id: string;
  name: string;
  createdAt: number;
  online: boolean;
  lastSeenAt: number | null;
  /** Processes the server runs on the host, including ones waiting for it. */
  processes: number;
}

const POLL_MS = 10_000;

/** `loaded` stays false until the first answer, so callers can tell "none" from "not yet known". */
let state: { hosts: RemoteHost[]; loaded: boolean } = { hosts: [], loaded: false };
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/**
 * Registered remote hosts with their online status, refreshed while any
 * component uses them. The server owns host state; this only mirrors it.
 */
export function useRemoteHosts(): { hosts: RemoteHost[]; loaded: boolean } {
  return useSyncExternalStore(subscribe, () => state);
}

/** Refresh the shared host list now, e.g. after adding or removing a host. */
export async function refreshRemoteHosts(): Promise<void> {
  try {
    const response = await fetch("/api/hosts");
    if (!response.ok) return;
    state = { hosts: ((await response.json()) as { hosts: RemoteHost[] }).hosts, loaded: true };
    for (const listener of listeners) listener();
  } catch {
    // Keep the last known list while the server is unreachable.
  }
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
