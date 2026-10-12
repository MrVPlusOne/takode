/**
 * Shared constants and formatting helpers for the Takode CLI and server peek/scan APIs.
 */

/** Content truncation limit for message text in peek, scan, and list views. */
export const TAKODE_PEEK_CONTENT_LIMIT = 500;

/**
 * Most worker sessions a leader keeps in its herd at once, set per leader backend because
 * a Claude leader's context lasts through more parallel work than a Codex leader's.
 * Reviewers never use worker slots.
 */
export interface WorkerSlotLimits {
  claude: number;
  codex: number;
}

export const DEFAULT_WORKER_SLOT_LIMITS: WorkerSlotLimits = { claude: 8, codex: 5 };

/** Highest limit Settings accepts. */
export const MAX_WORKER_SLOT_LIMIT = 50;

export function isValidWorkerSlotLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_WORKER_SLOT_LIMIT;
}

/** Fill missing or invalid per-backend limits from the defaults. */
export function normalizeWorkerSlotLimits(raw: unknown): WorkerSlotLimits {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof WorkerSlotLimits, unknown>>;
  return {
    claude: isValidWorkerSlotLimit(value.claude) ? value.claude : DEFAULT_WORKER_SLOT_LIMITS.claude,
    codex: isValidWorkerSlotLimit(value.codex) ? value.codex : DEFAULT_WORKER_SLOT_LIMITS.codex,
  };
}

/** The limit for a leader running on `backendType`; every non-Codex backend is Claude. */
export function workerSlotLimitFor(limits: WorkerSlotLimits, backendType: string | undefined): number {
  return backendType === "codex" ? limits.codex : limits.claude;
}

/** Escape a string for TypeScript-style string literal display.
 *  Used by herd event formatter, takode scan, and takode peek for consistent quoting. */
export function escapeStringLiteral(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

/** Truncate and format as a quoted string literal.
 *  Full message: "complete content."  Truncated: "truncated content" +42 chars
 *  Escapes special characters so multi-line content stays on one visual line. */
export function formatQuotedContent(s: string, limit: number): string {
  if (s.length <= limit) return `"${escapeStringLiteral(s)}"`;
  const remaining = s.length - limit;
  return `"${escapeStringLiteral(s.slice(0, limit))}" +${remaining} chars`;
}

/** Collapse stored agent labels like "#1563 System Leader 2" to "#1563".
 *  Falls back to the original label when no visible session number is present. */
export function formatCompactAgentLabel(sessionLabel: string | undefined): string | null {
  const label = sessionLabel?.trim();
  if (!label) return null;
  const sessionNumber = /^#\d+(?=$|\s)/.exec(label);
  return sessionNumber?.[0] ?? label;
}
