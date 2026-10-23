/**
 * Remembers, on this device, the visuals that caused trouble here, so they show as a
 * still picture instead of running again.
 *
 * Two ways in:
 * - the frame supervisor stopped a visual (it hung, crashed, kept the processor busy or
 *   slowed the page): `rememberVisualStopped`;
 * - a visual running in the page's own process (Safari) froze the page so hard that the
 *   app was reloaded. While such a visual's frame exists, its hash is written to
 *   localStorage; a mark still present when the app starts means the page froze while
 *   it ran.
 *
 * Running a visual again with Run forgets its entry; if it fails again, it is remembered again.
 */
const RUNNING_KEY = "takode:visual-running";
const FAILED_KEY = "takode:visual-failed-v2";
const MAX_REMEMBERED = 100;

/** Why a remembered visual was stopped, written to finish "Stopped on this device because …". */
export const FROZE_LAST_TIME = "it froze Takode the last time it ran";

let startupChecked = false;

type FailedEntry = { hash: string; reason: string };

function readJson<T>(key: string, valid: (value: unknown) => value is T): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(valid) : [];
  } catch {
    return [];
  }
}

function writeJson(key: string, list: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-MAX_REMEMBERED)));
  } catch {
    // Storage full or blocked: the guard degrades to this page load only.
  }
}

const isHash = (value: unknown): value is string => typeof value === "string";
const isEntry = (value: unknown): value is FailedEntry =>
  !!value && typeof (value as FailedEntry).hash === "string" && typeof (value as FailedEntry).reason === "string";

const memory = new Map<string, string>();

function failed(): FailedEntry[] {
  return readJson(FAILED_KEY, isEntry);
}

function remember(hash: string, reason: string): void {
  memory.set(hash, reason);
  writeJson(FAILED_KEY, [...failed().filter((entry) => entry.hash !== hash), { hash, reason }]);
}

function checkStartup(): void {
  if (startupChecked) return;
  startupChecked = true;
  const leftover = readJson(RUNNING_KEY, isHash);
  if (!leftover.length) return;
  for (const hash of leftover) remember(hash, FROZE_LAST_TIME);
  writeJson(RUNNING_KEY, []);
}

/** Why this visual was stopped on this device, or null when it may run. */
export function visualStopReason(hash: string): string | null {
  checkStartup();
  return memory.get(hash) ?? failed().find((entry) => entry.hash === hash)?.reason ?? null;
}

/** Remember a visual Takode stopped, so this device shows it as a still picture from now on. */
export function rememberVisualStopped(hash: string, reason: string): void {
  remember(hash, reason);
}

/** The user tapped Run: forget the earlier failure. */
export function forgetVisualFailure(hash: string): void {
  memory.delete(hash);
  writeJson(
    FAILED_KEY,
    failed().filter((entry) => entry.hash !== hash),
  );
}

/** Visuals running in the page's own process now, by hash, with how many frames show each. */
const running = new Map<string, number>();
let listening = false;

/**
 * Write the running marks. A page that is hidden or going away writes none: iOS may end a
 * backgrounded app without it freezing, and that must not count against the visuals on screen.
 * A frozen page runs no handlers, so its marks stay.
 */
function persistRunning(): void {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  writeJson(RUNNING_KEY, hidden ? [] : [...running.keys()]);
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", persistRunning);
  window.addEventListener("pagehide", () => writeJson(RUNNING_KEY, []));
}

/**
 * Mark a visual as running in the page's own process for as long as its frame exists;
 * returns the call that clears the mark. A visual can freeze the page at any time, not only
 * while loading, so the mark stays until the frame goes.
 */
export function markVisualRunning(hash: string): () => void {
  checkStartup();
  listen();
  running.set(hash, (running.get(hash) ?? 0) + 1);
  persistRunning();
  let cleared = false;
  return () => {
    if (cleared) return;
    cleared = true;
    const count = (running.get(hash) ?? 1) - 1;
    if (count > 0) running.set(hash, count);
    else running.delete(hash);
    persistRunning();
  };
}
