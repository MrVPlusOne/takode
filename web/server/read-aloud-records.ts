import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSettings } from "./settings-manager.js";
import { readAloudKeptOriginal, type ReadAloudTrace } from "./read-aloud.js";

const LIST_LIMIT = 50;
/** Newest records scanned once after a restart to find earlier audio for replays. */
const CACHE_SEED_RECORDS = 200;
const CLIENT_TIMINGS_KEPT = 20;
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
  /** Link facts given to the rewrite; missing on older records. */
  linkDetails?: string;
  trace: ReadAloudTrace;
  error: string | null;
  audioBytes: number;
  /** Identifies the same message read with the same settings, whose audio can be played again. */
  cacheKey?: string;
  /** What browsers measured when they played this record's audio, newest last. */
  clientTimings?: ReadAloudClientTiming[];
}

/** One playback as the browser saw it. */
export interface ReadAloudClientTiming {
  at: number;
  /** From the tap until the response started arriving: server work plus network delay. */
  waitMs: number;
  /** Downloading the audio. */
  downloadMs: number;
  /** From having the audio until it started playing (decoding and starting playback). */
  startMs: number;
  /** True when the server sent saved audio instead of making it again. */
  cached: boolean;
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
  private readonly idsByCacheKey = new Map<string, string>();
  private cacheSeeded: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();

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
    if (audio && record.cacheKey) this.idsByCacheKey.set(record.cacheKey, id);
    if (input.sourceId)
      await this.update(input.sourceId, (source) => ({ ...source, replayIds: [...source.replayIds, id] }));
    return record;
  }

  /** The newest successful record read with this cache key, if its audio is still there. */
  async findCached(cacheKey: string): Promise<ReadAloudRecord | null> {
    this.cacheSeeded ??= this.seedCache();
    await this.cacheSeeded;
    const id = this.idsByCacheKey.get(cacheKey);
    const record = id ? await this.get(id) : null;
    return record && !record.error && record.audioBytes > 0 ? record : null;
  }

  async addClientTiming(id: string, timing: ReadAloudClientTiming): Promise<boolean> {
    return this.update(id, (record) => ({
      ...record,
      clientTimings: [...(record.clientTimings ?? []), timing].slice(-CLIENT_TIMINGS_KEPT),
    }));
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
    const summaries: ReadAloudRecordSummary[] = [];
    for (const name of await this.recordNames()) {
      if (summaries.length >= LIST_LIMIT) break;
      const record = await this.get(name);
      if (!record || record.sourceId) continue;
      summaries.push(summarize(record));
    }
    return summaries;
  }

  /** Read-modify-write one record, one change at a time. Returns false when it does not exist. */
  private update(id: string, change: (record: ReadAloudRecord) => ReadAloudRecord): Promise<boolean> {
    const next = this.writes.then(async () => {
      const record = await this.get(id);
      if (!record) return false;
      await this.write(change(record));
      return true;
    });
    this.writes = next.catch(() => {});
    return next;
  }

  /** After a restart, remember the cache keys of recent reads so their audio can be played again. */
  private async seedCache(): Promise<void> {
    const names = await this.recordNames();
    for (const name of names.slice(0, CACHE_SEED_RECORDS)) {
      const record = await this.get(name).catch(() => null);
      if (record?.cacheKey && !record.error && record.audioBytes > 0 && !this.idsByCacheKey.has(record.cacheKey)) {
        this.idsByCacheKey.set(record.cacheKey, record.id);
      }
    }
  }

  /** Record folder names, newest first (names start with an ISO time). */
  private async recordNames(): Promise<string[]> {
    const names = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    return names
      .filter((name) => RECORD_ID_PATTERN.test(name))
      .sort()
      .reverse();
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
