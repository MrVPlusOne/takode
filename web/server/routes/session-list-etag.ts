import { SESSION_NAVIGATION_ROW_FIELDS } from "../../shared/session-navigation-projection.js";
import { SYNCED_PROJECTION_DESCRIPTOR_LIST } from "../../shared/synced-projection-registry.js";

const PROJECTION_FIELDS = new Set<string>(SYNCED_PROJECTION_DESCRIPTOR_LIST.map((descriptor) => descriptor.restField));

// The synced projections reach browsers over their session socket. A browser
// holding the navigation projection shows its values in place of the row's own
// copies of those fields (name, activity, git status, turn counts...).
const SOCKET_DELIVERED_FIELDS = new Set<string>([...PROJECTION_FIELDS, ...SESSION_NAVIGATION_ROW_FIELDS]);

/**
 * An ETag for a session list that ignores the fields a browser's session socket
 * keeps current. The sidebar re-reads the list every few seconds and names this
 * ETag only while its socket holds every listed session's projections; then a
 * read while only those fields changed (such as a git status refresh time) is a
 * 304 instead of the whole list.
 */
export function sessionListEtag(sessions: readonly object[]): string {
  const stable = sessions.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !SOCKET_DELIVERED_FIELDS.has(key))),
  );
  return `W/"${Bun.hash(JSON.stringify(stable)).toString(36)}"`;
}

/**
 * The list for a browser whose session socket already delivers the synced
 * projections: rows without the projection copies, over half of a busy list.
 */
export function withoutSyncedProjections<T extends object>(sessions: readonly T[]): T[] {
  return sessions.map(
    (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !PROJECTION_FIELDS.has(key))) as T,
  );
}
