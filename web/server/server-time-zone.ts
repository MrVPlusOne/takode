/**
 * The server's time zone setting. The server formats local times (chat source
 * tags, herd events, timers) with the process time zone, so applying the
 * setting means pointing the process's `TZ` at it once at startup, before
 * anything is formatted. Processes the server starts afterwards inherit it.
 */

/** The zone the server used before the setting was applied: what an empty setting gives. */
let defaultTimeZone: string | null = null;

/** The canonical IANA name for `zone` (e.g. `america/los_angeles` -> `America/Los_Angeles`), or null when it is not a time zone. */
export function canonicalTimeZone(zone: string): string | null {
  const trimmed = zone.trim();
  if (!trimmed) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The zone this process formats local times in. */
export function timeZoneInEffect(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Apply the configured zone (a canonical name, or "" for the machine's zone)
 * to this process. Call once at startup, before anything formats a local time;
 * a changed setting takes effect at the next start.
 */
export function applyServerTimeZone(zone: string): void {
  defaultTimeZone = timeZoneInEffect();
  if (!zone) return;
  process.env.TZ = zone;
  // Bun applies the zone but keeps a TZ assigned at runtime out of process.env's
  // enumerable keys, so launch environments built from `{ ...process.env }` would
  // drop it. A plain property keeps it there for the processes the server starts.
  if (!Object.keys(process.env).includes("TZ")) {
    Object.defineProperty(process.env, "TZ", { value: zone, enumerable: true, writable: true, configurable: true });
  }
}

/** The zone an empty setting gives: the machine's (or launch environment's) zone. */
export function serverDefaultTimeZone(): string {
  return defaultTimeZone ?? timeZoneInEffect();
}
