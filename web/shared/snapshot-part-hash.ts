/**
 * A hash of a large subscribe snapshot part (the completed work board, the
 * session tree groups, the notification and attention lists) as JSON. The
 * browser names the hash of the copy it holds when it subscribes, and the
 * server leaves the part out when its own copy hashes the same, so a revisit
 * does not download it again. Both sides serialize with plain
 * `JSON.stringify`: a copy parsed from the server's JSON serializes back
 * identically, and any difference only costs a resend.
 */
export function snapshotPartHash(value: unknown): string {
  return snapshotTextHash(JSON.stringify(value) ?? "");
}

/** `snapshotPartHash` of a value already serialized to JSON. */
export function snapshotTextHash(text: string): string {
  // Two independent 32-bit multiply-xor streams (cyrb53-style), 64 bits together.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}-${(h1 >>> 0).toString(36)}-${text.length.toString(36)}`;
}

/** Parts of the subscribe snapshot a browser may already hold, by the hash of its copy. */
export interface KnownSnapshotParts {
  completed_board?: string;
  tree_groups?: string;
  notifications?: string;
  attention_records?: string;
}
