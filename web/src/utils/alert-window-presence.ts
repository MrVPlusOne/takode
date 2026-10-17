/**
 * Picks one Takode window of this browser to play alert sounds: the one the user
 * used most recently, so two open windows don't both ring. Windows share a small
 * record in localStorage; each notes when it was last used and keeps a heartbeat,
 * so a window that closed without saying so stops counting after a few minutes.
 */

export const ALERT_WINDOWS_STORAGE_KEY = "cc-alert-windows";

/** A window counts as open while its heartbeat is newer than this. Background tabs run timers about once a minute. */
const ALIVE_MS = 3 * 60_000;
const HEARTBEAT_MS = 30_000;
const USE_EVENTS = ["focus", "pointerdown", "keydown"] as const;

type AlertWindowRecord = { usedAt: number; aliveAt: number };

const windowId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Start recording this window's use; returns a cleanup that also removes its record. */
export function startAlertWindowPresence(): () => void {
  let lastUseWrite = 0;
  const markUsed = () => {
    // Typing fires this per key; one write a second keeps the order accurate enough.
    if (Date.now() - lastUseWrite < 1000) return;
    lastUseWrite = Date.now();
    updateOwnRecord((record) => ({ ...record, usedAt: lastUseWrite }));
  };
  const markVisibleUse = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) markUsed();
  };
  const heartbeat = () => updateOwnRecord((record) => record);
  const remove = () => writeRecords(omitOwn(readRecords()));

  if (document.hasFocus()) markUsed();
  else heartbeat();
  for (const type of USE_EVENTS) window.addEventListener(type, markUsed, true);
  document.addEventListener("visibilitychange", markVisibleUse);
  window.addEventListener("pagehide", remove);
  const timer = setInterval(heartbeat, HEARTBEAT_MS);
  return () => {
    for (const type of USE_EVENTS) window.removeEventListener(type, markUsed, true);
    document.removeEventListener("visibilitychange", markVisibleUse);
    window.removeEventListener("pagehide", remove);
    clearInterval(timer);
    remove();
  };
}

/**
 * Whether this window should play an alert. True when no other open window was
 * used more recently, including when storage is unavailable or this window has
 * not registered (then every window plays, as before this rule existed).
 */
export function isMostRecentlyUsedAlertWindow(now = Date.now()): boolean {
  const records = readRecords();
  const own = records[windowId];
  if (!own) return true;
  return Object.entries(records).every(
    ([id, record]) => id === windowId || now - record.aliveAt > ALIVE_MS || record.usedAt <= own.usedAt,
  );
}

function updateOwnRecord(change: (record: AlertWindowRecord) => AlertWindowRecord): void {
  const now = Date.now();
  const records = readRecords();
  const fresh = Object.fromEntries(Object.entries(records).filter(([, record]) => now - record.aliveAt <= ALIVE_MS));
  const own = change(records[windowId] ?? { usedAt: 0, aliveAt: now });
  writeRecords({ ...fresh, [windowId]: { ...own, aliveAt: now } });
}

function omitOwn(records: Record<string, AlertWindowRecord>): Record<string, AlertWindowRecord> {
  const { [windowId]: _own, ...others } = records;
  return others;
}

function readRecords(): Record<string, AlertWindowRecord> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ALERT_WINDOWS_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, AlertWindowRecord] =>
          typeof (entry[1] as AlertWindowRecord | null)?.usedAt === "number" &&
          typeof (entry[1] as AlertWindowRecord | null)?.aliveAt === "number",
      ),
    );
  } catch (error) {
    console.warn("[notification] ignoring unreadable alert window presence", error);
    return {};
  }
}

function writeRecords(records: Record<string, AlertWindowRecord>): void {
  try {
    localStorage.setItem(ALERT_WINDOWS_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn("[notification] could not record alert window presence", error);
  }
}
