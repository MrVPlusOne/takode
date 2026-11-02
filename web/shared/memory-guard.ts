/**
 * Source of the message that tells a session the memory guard of its machine's
 * `takode node` killed its processes because the machine was nearly out of memory.
 */
export const MEMORY_GUARD_MESSAGE_SOURCE = { sessionId: "memory-guard", sessionLabel: "Memory guard" } as const;

/** First words of that message, which the feed's chip recognizes. */
export const MEMORY_GUARD_MESSAGE_TAG = "[Memory guard]";
