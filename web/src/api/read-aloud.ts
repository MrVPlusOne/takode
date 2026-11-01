import type { ReadAloudRecord, ReadAloudRecordSummary } from "../../server/read-aloud-records.js";
import type { ReadAloudSettings } from "../../server/read-aloud.js";
import { ReadAloudStreamDecoder } from "../../shared/read-aloud-stream.js";

export type { ReadAloudRecord, ReadAloudRecordSummary, ReadAloudSettings };

export interface ReadAloudRecordDetail {
  record: ReadAloudRecord;
  replays: ReadAloudRecord[];
  defaults: ReadAloudSettings;
  voices: string[];
  /** Speech models to compare, each with the voices it accepts. */
  speechModels: Array<{ model: string; voices: string[] }>;
}

/** One piece of a read's audio, playable on its own. */
export interface ReadAloudPiece {
  blob: Blob;
  seconds: number;
}

/**
 * The audio of one read while it arrives: pieces in text order, each playable as soon as it is
 * here, then whether the read finished or failed. `changed` fires after every frame.
 */
export class ReadAloudStream {
  readonly pieces: ReadAloudPiece[] = [];
  done = false;
  error: string | null = null;
  /** The debug record holding this audio, for reporting the browser's timing (known when done). */
  recordId: string | null = null;
  /** True when the server played back audio it had already made. */
  cached = false;
  /** From sending the request until the first piece arrived. */
  waitMs = 0;
  /** From the first piece until the read was complete. */
  downloadMs = 0;
  private readonly listeners = new Set<() => void>();

  /** Calls `listener` after every new piece and when the read ends. Returns the unsubscribe. */
  changed(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Seconds of audio received so far. */
  get seconds(): number {
    return this.pieces.reduce((total, piece) => total + piece.seconds, 0);
  }

  /** @internal */
  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Start reading one message or report aloud (rewritten for listening when needed) and return its
 * audio as it streams in. For one slide of a deck being played, `text` is its narration and
 * `slide.shown` what the slide shows. Failures, before or during the stream, end it with `error`.
 */
export function openReadAloudStream(
  input: {
    sessionId: string;
    messageId: string;
    text: string;
    historyIndex?: number;
    voice: string;
    slide?: { shown: string };
  },
  signal: AbortSignal,
): ReadAloudStream {
  const stream = new ReadAloudStream();
  const startedAt = performance.now();
  let firstPieceAt = 0;
  const end = (error: string | null) => {
    if (stream.done || stream.error) return;
    if (error) stream.error = error;
    else stream.done = true;
    if (firstPieceAt) stream.downloadMs = performance.now() - firstPieceAt;
    stream.notify();
  };
  void (async () => {
    const res = await request(`/sessions/${encodeURIComponent(input.sessionId)}/read-aloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: input.messageId,
        text: input.text,
        historyIndex: input.historyIndex,
        voice: input.voice,
        ...(input.slide ? { slide: input.slide } : {}),
      }),
      signal,
    });
    const decoder = new ReadAloudStreamDecoder();
    const reader = res.body!.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const frame of decoder.push(value)) {
        if (frame.type === "piece") {
          if (!firstPieceAt) {
            firstPieceAt = performance.now();
            stream.waitMs = firstPieceAt - startedAt;
          }
          stream.pieces.push({ blob: new Blob([frame.mp3], { type: "audio/mpeg" }), seconds: frame.seconds });
          stream.notify();
        } else if (frame.type === "done") {
          stream.recordId = frame.recordId;
          stream.cached = frame.cached;
          end(null);
        } else {
          end(frame.message);
        }
      }
    }
    end(stream.done ? null : "Read aloud stopped before the audio was complete");
  })().catch((error: unknown) => end(error instanceof Error ? error.message : String(error)));
  return stream;
}

/** Attach what this browser measured to the read's debug record. Failures are only logged. */
export function reportReadAloudTiming(
  recordId: string,
  timing: { waitMs: number; downloadMs: number; startMs: number; cached: boolean },
): void {
  request(`/read-aloud/records/${encodeURIComponent(recordId)}/client-timing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timing),
  }).catch((error: unknown) => console.warn("[read-aloud] Could not report playback timing:", error));
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
