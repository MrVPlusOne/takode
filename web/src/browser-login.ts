import { useSyncExternalStore } from "react";

/** Header the server sets on 401 responses that need a browser login. */
const LOGIN_REQUIRED_HEADER = "x-takode-login-required";

export interface LoginStatus {
  /** Whether this server requires a browser login at all. */
  enabled: boolean;
  loggedIn: boolean;
  minPasswordLength: number;
}

/** What the app shell shows: nothing while the first check runs, the login screen, or the app. */
export type LoginGateState = "checking" | "login" | "app";

let gateState: LoginGateState = "checking";
/** Once the app has run, logging back in reloads it so its connections start fresh. */
let appWasShown = false;
let pendingCheck: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function useLoginGate(): LoginGateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => gateState,
  );
}

/**
 * Ask the server whether this browser must log in. A server that cannot be
 * reached leaves the app shown, which has its own unreachable-server handling.
 * Concurrent checks share one request.
 */
export function checkLogin(): Promise<void> {
  pendingCheck ??= fetchLoginStatus()
    .then((status) => setGateState(status.enabled && !status.loggedIn ? "login" : "app"))
    .catch(() => {
      if (gateState === "checking") setGateState("app");
    })
    .finally(() => {
      pendingCheck = null;
    });
  return pendingCheck;
}

/**
 * Show the login screen as soon as any API call reports that the login has
 * expired or was revoked, instead of updating every caller of `fetch`.
 */
export function installLoginRequiredWatcher(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (response.status === 401 && response.headers.get(LOGIN_REQUIRED_HEADER)) setGateState("login");
    return response;
  }) as typeof window.fetch;
}

export async function fetchLoginStatus(): Promise<LoginStatus> {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as LoginStatus;
}

export async function logIn(password: string): Promise<void> {
  await send("POST", "/api/auth/login", { password });
  if (appWasShown) window.location.reload();
  else setGateState("app");
}

/** Log this browser out. Reloading drops the open connections, which stay authenticated otherwise. */
export async function logOut(): Promise<void> {
  await send("POST", "/api/auth/logout");
  window.location.reload();
}

/** Turn login on, or change the password (which needs the current one). Signs out every other browser. */
export function setLoginPassword(password: string, currentPassword?: string): Promise<void> {
  return send("PUT", "/api/auth/password", { password, ...(currentPassword ? { currentPassword } : {}) });
}

export function turnOffLogin(currentPassword: string): Promise<void> {
  return send("DELETE", "/api/auth/password", { currentPassword });
}

export function signOutOtherDevices(): Promise<void> {
  return send("POST", "/api/auth/sign-out-others");
}

async function send(method: string, url: string, body?: object): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.ok) return;
  const failure = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(failure.error || `HTTP ${response.status}`);
}

function setGateState(next: LoginGateState): void {
  if (gateState === next) return;
  gateState = next;
  if (next === "app") appWasShown = true;
  for (const listener of listeners) listener();
}

/** Restore the initial state between tests. */
export function resetLoginGateForTest(): void {
  gateState = "checking";
  appWasShown = false;
  pendingCheck = null;
}
