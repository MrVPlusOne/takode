import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSettings } from "./settings-manager.js";
import { readAloudKeptOriginal, type ReadAloudTrace } from "./read-aloud.js";

const LIST_LIMIT = 50;
const PREVIEW_CHARS = 160;
const RECORD_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** One read aloud: what went in, what each step produced, and whether it failed. */
export interface ReadAloudRecord {
  id: string;
  timestamp: number;
  sessionId: string;
  messageId: string;
  /** Set on a replay: the record whose message and context it reused. */
  sourceId?: string;
  /** Replays of this record, oldest first. */
  replayIds: string[];
  messageText: string;
  conversationContext: string;
  trace: ReadAloudTrace;
  error: string | null;
  audioBytes: number;
}

/** A list row: no message, context or prompts beyond a one-line preview. */
export interface ReadAloudRecordSummary {
  id: string;
  timestamp: number;
  sessionId: string;
  previewText: string;
  voice: string;
  keptOriginal: boolean;
  rewriteMs: number;
  speechMs: number;
  replayCount: number;
  error: string | null;
}

/**
 * Debug records of read-aloud requests, one folder per read with `record.json` and
 * `audio.mp3`, under ~/.companion/read-aloud-recordings/<server>/ by default. Kept
 * like transcription recordings so prompts and audio can be inspected and replayed.
 */
export class ReadAloudRecordStore {
  /** Without a root, the default folder is resolved on each use, after settings load. */
  constructor(private readonly rootOverride?: string) {}

  private get root(): string {
    return this.rootOverride ?? defaultReadAloudRecordRoot();
  }

  /** Save a new record and its audio; a replay is also linked from its source. */
  async create(
    input: Omit<ReadAloudRecord, "id" | "timestamp" | "replayIds" | "audioBytes">,
    audio: Uint8Array | null,
  ): Promise<ReadAloudRecord> {
    const timestamp = Date.now();
    const id = `${new Date(timestamp).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const record: ReadAloudRecord = { ...input, id, timestamp, replayIds: [], audioBytes: audio?.length ?? 0 };
    await mkdir(this.dir(id), { recursive: true });
    if (audio) await writeFile(join(this.dir(id), "audio.mp3"), audio);
    await this.write(record);
    if (input.sourceId) {
      const source = await this.get(input.sourceId);
      if (source) await this.write({ ...source, replayIds: [...source.replayIds, id] });
    }
    return record;
  }

  async get(id: string): Promise<ReadAloudRecord | null> {
    if (!RECORD_ID_PATTERN.test(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir(id), "record.json"), "utf-8")) as ReadAloudRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readAudio(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!RECORD_ID_PATTERN.test(id)) return null;
    try {
      return new Uint8Array(await readFile(join(this.dir(id), "audio.mp3")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** The most recent reads started from a message (replays appear inside their source). */
  async listRecent(): Promise<ReadAloudRecordSummary[]> {
    const names = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    const summaries: ReadAloudRecordSummary[] = [];
    // Folder names start with an ISO time, so name order is time order.
    for (const name of names.sort().reverse()) {
      if (summaries.length >= LIST_LIMIT) break;
      const record = await this.get(name);
      if (!record || record.sourceId) continue;
      summaries.push(summarize(record));
    }
    return summaries;
  }

  private dir(id: string): string {
    return join(this.root, id);
  }

  private async write(record: ReadAloudRecord): Promise<void> {
    await writeFile(join(this.dir(record.id), "record.json"), JSON.stringify(record, null, 2));
  }
}

function defaultReadAloudRecordRoot(): string {
  const serverSlug = (getSettings().serverSlug || "local").replace(/[^A-Za-z0-9._-]/g, "_");
  return join(homedir(), ".companion", "read-aloud-recordings", serverSlug);
}

function summarize(record: ReadAloudRecord): ReadAloudRecordSummary {
  const oneLine = record.messageText.replace(/\s+/g, " ").trim();
  return {
    id: record.id,
    timestamp: record.timestamp,
    sessionId: record.sessionId,
    previewText: oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS - 1)}…` : oneLine,
    voice: record.trace.settings.voice,
    keptOriginal: readAloudKeptOriginal(record.trace),
    rewriteMs: record.trace.rewriteMs,
    speechMs: record.trace.speechMs,
    replayCount: record.replayIds.length,
    error: record.error,
  };
}
