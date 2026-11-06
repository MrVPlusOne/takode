/**
 * Source of the message that tells a session the memory guard of its machine's
 * `takode node` killed its processes because the machine was nearly out of memory.
 */
export const MEMORY_GUARD_MESSAGE_SOURCE = { sessionId: "memory-guard", sessionLabel: "Memory guard" } as const;

/** First words of that message, which the feed's chip recognizes. */
export const MEMORY_GUARD_MESSAGE_TAG = "[Memory guard]";

/** Format a memory size for people: `47.3 GB`, or `512 MB` under a gigabyte. */
export function formatBytes(bytes: number): string {
  return bytes < 2 ** 30 ? `${Math.round(bytes / 2 ** 20)} MB` : `${(bytes / 2 ** 30).toFixed(1)} GB`;
}
