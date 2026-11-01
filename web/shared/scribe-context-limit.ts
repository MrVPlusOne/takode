/**
 * How much context a leader's Scribe works within. A Scribe keeps running for as long as its leader
 * does, so its conversation is compacted before it grows past this limit, which bounds what each
 * of its turns costs. Settings can change it.
 */
export const DEFAULT_SCRIBE_CONTEXT_LIMIT_TOKENS = 256_000;
/** Below this, a backend's own instructions and tools leave too little room to work in. */
export const MIN_SCRIBE_CONTEXT_LIMIT_TOKENS = 100_000;
export const MAX_SCRIBE_CONTEXT_LIMIT_TOKENS = 1_000_000;

/** A whole number of tokens within the allowed range; anything else is the default. */
export function normalizeScribeContextLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SCRIBE_CONTEXT_LIMIT_TOKENS;
  return Math.min(MAX_SCRIBE_CONTEXT_LIMIT_TOKENS, Math.max(MIN_SCRIBE_CONTEXT_LIMIT_TOKENS, Math.round(value)));
}
