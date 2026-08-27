import type {
  CodexNativeSubagentCoverage,
  CodexNativeSubagentTranscriptAvailability,
} from "../../shared/codex-native-subagent-types.js";
import type { BrowserIncomingMessage } from "../types.js";

const DEFAULT_HISTORY_PAGE_SIZE = 30;
const MAX_HISTORY_PAGE_SIZE = 50;

export interface CodexNativeSubagentHistoryPage {
  /** Bounded, server-filtered child-owned records with their stable stored identities. */
  messages: BrowserIncomingMessage[];
  /** Opaque server cursor. Browsers must not inspect or construct it. */
  nextCursor: string | null;
  availability: CodexNativeSubagentTranscriptAvailability;
  coverage: CodexNativeSubagentCoverage;
}

export interface FetchCodexNativeSubagentHistoryOptions {
  sessionId: string;
  /** Opaque Takode child ID, never a provider thread ID. */
  childId: string;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export class CodexNativeSubagentHistoryError extends Error {
  constructor(public readonly status: number) {
    super("Codex subagent history request failed");
    this.name = "CodexNativeSubagentHistoryError";
  }
}

function isAvailability(value: unknown): value is CodexNativeSubagentTranscriptAvailability {
  return value === "available" || value === "partial" || value === "unavailable";
}

function isCoverage(value: unknown): value is CodexNativeSubagentCoverage {
  return value === "complete" || value === "partial";
}

function hasInvalidOrMismatchedOwnership(message: unknown, childId: string): boolean {
  if (typeof message !== "object" || message === null) return true;
  const ownership = (message as { codexSubagent?: unknown }).codexSubagent;
  if (typeof ownership !== "object" || ownership === null) return true;
  const candidate = ownership as { childId?: unknown; parentChildId?: unknown; rootTurnId?: unknown };
  return (
    candidate.childId !== childId ||
    typeof candidate.rootTurnId !== "string" ||
    candidate.rootTurnId.length === 0 ||
    (candidate.parentChildId !== undefined &&
      (typeof candidate.parentChildId !== "string" || candidate.parentChildId.length === 0))
  );
}

/**
 * Fetch one bounded page of server-authored native-child history.
 *
 * Both identifiers and the cursor are treated as opaque URL components. Error
 * bodies are deliberately not surfaced because this read-only view must not
 * echo provider IDs, rollout paths, or other backend diagnostics.
 */
export async function fetchCodexNativeSubagentHistory({
  sessionId,
  childId,
  cursor,
  limit = DEFAULT_HISTORY_PAGE_SIZE,
  signal,
}: FetchCodexNativeSubagentHistoryOptions): Promise<CodexNativeSubagentHistoryPage> {
  const requestedLimit = Math.floor(limit);
  const boundedLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, requestedLimit))
    : DEFAULT_HISTORY_PAGE_SIZE;
  const params = new URLSearchParams({ limit: String(boundedLimit) });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/codex-native-subagents/${encodeURIComponent(childId)}/history?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) throw new CodexNativeSubagentHistoryError(response.status);

  const body = (await response.json()) as Partial<CodexNativeSubagentHistoryPage>;
  if (
    !Array.isArray(body.messages) ||
    body.messages.some((message) => hasInvalidOrMismatchedOwnership(message, childId)) ||
    (body.nextCursor !== undefined && body.nextCursor !== null && typeof body.nextCursor !== "string") ||
    !isAvailability(body.availability) ||
    !isCoverage(body.coverage)
  ) {
    throw new Error("Invalid Codex subagent history response");
  }

  return {
    messages: body.messages,
    nextCursor: body.nextCursor ?? null,
    availability: body.availability,
    coverage: body.coverage,
  };
}
