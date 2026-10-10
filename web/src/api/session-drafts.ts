import type { SessionDraftChange, SessionDraftWriteRequest, SessionDraftsState } from "../../shared/session-drafts.js";

/** A draft write the server refused for good (for example, its prompt was already resolved). */
export class DraftWriteRejectedError extends Error {}

/** Current server drafts of a session, for a browser that is not subscribed to it. */
export async function fetchSessionDrafts(sessionId: string): Promise<SessionDraftsState> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/drafts`);
  if (!res.ok) throw new Error(`Could not load drafts (${res.status})`);
  return ((await res.json()) as { drafts: SessionDraftsState }).drafts;
}

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
