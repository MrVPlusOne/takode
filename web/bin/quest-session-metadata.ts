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

export async function fetchSessionMetadataMap(
  companionPort: string | undefined,
  headers: Record<string, string>,
): Promise<Map<string, SessionMetadata>> {
  if (!companionPort) return new Map();
  try {
    const res = await fetch(`http://localhost:${companionPort}/api/sessions`, {
      headers,
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(res.statusText);
    const payload = (await res.json()) as SessionPayload;
    return parseSessionMetadataMap(payload);
  } catch {
    return new Map();
  }
}
