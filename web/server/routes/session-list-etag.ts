import { SYNCED_PROJECTION_DESCRIPTOR_LIST } from "../../shared/synced-projection-registry.js";

// The synced projections reach browsers over their session socket, and the
// navigation projection carries each session's activity time.
const SOCKET_DELIVERED_FIELDS = new Set<string>([
  ...SYNCED_PROJECTION_DESCRIPTOR_LIST.map((descriptor) => descriptor.restField),
  "lastActivityAt",
]);

/**
 * An ETag for a session list that ignores the fields a browser's session socket
 * keeps current. The sidebar re-reads the list every few seconds; with this, a
 * read while only those fields changed is a 304 instead of the whole list.
 */
export function sessionListEtag(sessions: readonly object[]): string {
  const stable = sessions.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !SOCKET_DELIVERED_FIELDS.has(key))),
  );
  return `W/"${Bun.hash(JSON.stringify(stable)).toString(36)}"`;
}
