import type { SessionDraftChange, SessionDraftWriteRequest } from "../../shared/session-drafts.js";
import type { PendingVoiceResult } from "../../shared/voice-results.js";

/** A draft write the server refused for good (for example, its prompt was already resolved). */
export class DraftWriteRejectedError extends Error {}

/**
 * Saves one draft change. `keepalive` lets the request finish while the page is
 * being hidden or unloaded, such as iOS putting the Home Screen app away.
 */
export async function writeSessionDraft(
  sessionId: string,
  request: SessionDraftWriteRequest,
  options: { keepalive?: boolean } = {},
): Promise<SessionDraftChange> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/drafts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    ...(options.keepalive ? { keepalive: true } : {}),
  });
  if (res.status === 400 || res.status === 404 || res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new DraftWriteRejectedError(body.error || res.statusText);
  }
  if (!res.ok) throw new Error(`Could not save draft (${res.status})`);
  return ((await res.json()) as { change: SessionDraftChange }).change;
}

/**
 * Takes a finished voice transcription the server kept for this session's drafts. Resolves to the
 * result when this browser is the first to ask, or null when another browser already took it.
 */
export async function claimVoiceResult(sessionId: string, requestId: string): Promise<PendingVoiceResult | null> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/drafts/voice-results/${encodeURIComponent(requestId)}/claim`,
    { method: "POST" },
  );
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw new Error(`Could not claim the voice result (${res.status})`);
  return ((await res.json()) as { result: PendingVoiceResult }).result;
}

/** The server skips conversations it checked in the last minute anyway; this spares the requests. */
const SLACK_REFRESH_INTERVAL_MS = 60_000;
const lastSlackRefresh = new Map<string, number>();

/**
 * Asks the server to check the Slack conversations this session watches, because the user opened
 * one of its questions and may answer it; typing a draft does the same on the server's side. At
 * most once a minute per session.
 */
export function requestSlackRefresh(sessionId: string): void {
  const now = Date.now();
  if (now - (lastSlackRefresh.get(sessionId) ?? -Infinity) < SLACK_REFRESH_INTERVAL_MS) return;
  lastSlackRefresh.set(sessionId, now);
  fetch(`/api/sessions/${encodeURIComponent(sessionId)}/slack-refresh`, {
    method: "POST",
  }).catch((error: unknown) => console.warn("[takode] Could not ask for fresh Slack updates:", error));
}
