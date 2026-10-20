import type { ReadAloudRecord, ReadAloudRecordSummary } from "../../server/read-aloud-records.js";
import type { ReadAloudSettings } from "../../server/read-aloud.js";

export type { ReadAloudRecord, ReadAloudRecordSummary, ReadAloudSettings };

export interface ReadAloudRecordDetail {
  record: ReadAloudRecord;
  replays: ReadAloudRecord[];
  defaults: ReadAloudSettings;
  voices: string[];
}

/** Fetch MP3 audio of one assistant message read aloud (rewritten for listening when needed). */
export async function fetchReadAloudAudio(
  input: { sessionId: string; messageId: string; text: string; historyIndex?: number; voice: string },
  signal: AbortSignal,
): Promise<Blob> {
  const res = await request(`/sessions/${encodeURIComponent(input.sessionId)}/read-aloud`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: input.messageId,
      text: input.text,
      historyIndex: input.historyIndex,
      voice: input.voice,
    }),
    signal,
  });
  return res.blob();
}

export async function listReadAloudRecords(): Promise<ReadAloudRecordSummary[]> {
  return ((await (await request("/read-aloud/records")).json()) as { records: ReadAloudRecordSummary[] }).records;
}

export async function getReadAloudRecord(id: string): Promise<ReadAloudRecordDetail> {
  return (await request(`/read-aloud/records/${encodeURIComponent(id)}`)).json();
}

/** Audio of a record as a blob, so it plays without range requests (which iOS media loading may need). */
export async function fetchReadAloudRecordAudio(id: string): Promise<Blob> {
  return (await request(`/read-aloud/records/${encodeURIComponent(id)}/audio`)).blob();
}

/** Read a recorded message again; `rewriteSystemPrompt: null` skips the rewrite. */
export async function replayReadAloudRecord(
  id: string,
  settings: Partial<ReadAloudSettings>,
): Promise<ReadAloudRecord> {
  const res = await request(`/read-aloud/records/${encodeURIComponent(id)}/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return ((await res.json()) as { record: ReadAloudRecord }).record;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, init);
  if (res.ok) return res;
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === "string" && body.error ? body.error : `Read aloud failed (${res.status})`);
}
