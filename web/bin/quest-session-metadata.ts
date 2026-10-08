export type SessionMetadata = {
  archived: boolean;
  sessionNum?: number | null;
  name?: string;
};

type SessionPayload =
  | { sessions?: { sessionId: string; archived?: boolean; sessionNum?: number | null; name?: string }[] }
  | { sessionId: string; archived?: boolean; sessionNum?: number | null; name?: string }[];

export function parseSessionMetadataMap(payload: SessionPayload): Map<string, SessionMetadata> {
  const sessions = Array.isArray(payload) ? payload : Array.isArray(payload.sessions) ? payload.sessions : [];
  return new Map(
    sessions.map((session) => [
      session.sessionId,
      {
        archived: !!session.archived,
        sessionNum: session.sessionNum,
        name: session.name,
      },
    ]),
  );
}

/** Quest fields that hold session IDs: `sessionId`, `leaderSessionId`, `previousOwnerSessionIds` and the like. */
const SESSION_ID_KEY = /sessionids?$/i;

/** The session IDs held anywhere inside `value`, so labels are fetched only for sessions the output can mention. */
export function collectSessionIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return ids;
  for (const [key, item] of Object.entries(value)) {
    if (SESSION_ID_KEY.test(key)) {
      for (const id of Array.isArray(item) ? item : [item]) if (typeof id === "string" && id) ids.add(id);
    } else {
      collectSessionIds(item, ids);
    }
  }
  return ids;
}

/**
 * Fetch name, number and archived state for the given sessions. The labels are
 * best effort: without a reachable server, output falls back to raw session IDs.
 */
export async function fetchSessionMetadataMap(
  companionPort: string | undefined,
  headers: Record<string, string>,
  sessionIds: Set<string>,
): Promise<Map<string, SessionMetadata>> {
  if (!companionPort || sessionIds.size === 0) return new Map();
  try {
    const res = await fetch(`http://localhost:${companionPort}/api/sessions/_labels`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: [...sessionIds] }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(res.statusText);
    const payload = (await res.json()) as SessionPayload;
    return parseSessionMetadataMap(payload);
  } catch {
    return new Map();
  }
}
