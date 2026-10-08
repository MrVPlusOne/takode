import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  HISTORY_STRING_CHARS,
  stringFrames,
  valueDigest,
  valueTokens,
  type JsonValue,
} from "./session-history-codec.js";

export interface HistoryReference {
  version: 1;
  generation: string;
  bytes: number;
  revision: number;
  messageCount: number;
  toolCount: number;
  frozenCount: number;
  frozenToolCount: number;
}

interface Range {
  start: number;
  end: number;
}
interface StringRange extends Range {
  id: number;
  length: number;
}
interface RowRange extends Range {
  digest: string;
}
interface JournalCache {
  head: HistoryReference;
  strings: Map<string, StringRange>;
  messages: RowRange[];
  tools: RowRange[];
  nextId: number;
}
interface JournalIndex {
  strings: Map<number, StringRange>;
  messages: Map<number, RowRange>;
  tools: Map<number, RowRange>;
}
/** A row is decoded when its record ends; one that does not decode yet keeps its tokens until the scan ends. */
type DecodedRow = { value: JsonValue } | { tokens: unknown[][] };
/** Values materialized during the index scan, so a read needs one sequential pass instead of one stream per record. */
interface DecodedJournal {
  strings: Map<number, string>;
  messages: Map<number, DecodedRow>;
  tools: Map<number, DecodedRow>;
}

const HISTORY_SCAN_SLICE_MS = 20;

/** Committed new-format corruption must survive the legacy startup skip policy. */
export class SessionHistoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionHistoryError";
  }
}

export function historyPath(dir: string, sessionId: string, generation: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !/^[0-9a-f-]{36}$/.test(generation)) {
    throw new SessionHistoryError("Invalid history file identity");
  }
  return join(dir, `${sessionId}.history-${generation}.data`);
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validateHistoryReference(value: HistoryReference): void {
  if (
    !value ||
    value.version !== 1 ||
    ![value.bytes, value.revision, value.messageCount, value.toolCount, value.frozenCount, value.frozenToolCount].every(
      integer,
    ) ||
    value.bytes === 0 ||
    value.frozenCount > value.messageCount ||
    value.frozenToolCount > value.toolCount
  ) {
    throw new SessionHistoryError("Invalid committed history reference");
  }
}

/** Scan bounded frames in an exact byte range; partial lines never count as committed data. */
export async function* historyFrames(
  path: string,
  range: Range,
): AsyncGenerator<{ value: unknown[]; start: number; end: number }> {
  const input = createReadStream(path, { start: range.start, end: range.end - 1, highWaterMark: 64 * 1024 });
  let pending = Buffer.alloc(0);
  let offset = range.start;
  let sliceStart = performance.now();
  try {
    for await (const chunk of input) {
      // Buffered stream chunks resolve as microtasks, so a long scan would otherwise hold the event loop.
      if (performance.now() - sliceStart > HISTORY_SCAN_SLICE_MS) {
        await new Promise((resolve) => setImmediate(resolve));
        sliceStart = performance.now();
      }
      pending = Buffer.concat([pending, chunk as Buffer]);
      let start = 0;
      for (;;) {
        const newline = pending.indexOf(10, start);
        if (newline < 0) break;
        if (newline - start > 128 * 1024) throw new SessionHistoryError("Oversized history frame");
        const value: unknown = JSON.parse(pending.subarray(start, newline).toString("utf8"));
        if (!Array.isArray(value)) throw new SessionHistoryError("Invalid history frame");
        const end = offset + newline + 1 - start;
        yield { value, start: offset, end };
        offset = end;
        start = newline + 1;
      }
      pending = pending.subarray(start);
      if (pending.length > 128 * 1024) throw new SessionHistoryError("Oversized history frame");
    }
    if (pending.length || offset !== range.end) throw new SessionHistoryError("Incomplete committed history extent");
  } finally {
    input.destroy();
  }
}

export function historyCommitFrame(head: HistoryReference): unknown[] {
  return ["commit", head.revision, head.messageCount, head.toolCount, head.frozenCount, head.frozenToolCount];
}

async function indexJournal(
  path: string,
  sessionId: string,
  head: HistoryReference,
  decoded?: DecodedJournal,
): Promise<JournalIndex> {
  validateHistoryReference(head);
  const index: JournalIndex = { strings: new Map(), messages: new Map(), tools: new Map() };
  let string: StringRange | undefined;
  let stringChars = 0;
  let parts: string[] = [];
  let row: { kind: "message" | "tool"; index: number; range: RowRange } | undefined;
  let tokens: unknown[][] = [];
  let last: unknown[] = [];
  let first = true;
  for await (const frame of historyFrames(path, { start: 0, end: head.bytes })) {
    const v = frame.value;
    if (first) {
      first = false;
      if (JSON.stringify(v) !== JSON.stringify(["history", 1, sessionId, head.generation]))
        throw new SessionHistoryError("History identity mismatch");
    } else if (string) {
      if (v[0] === "part" && v.length === 2 && typeof v[1] === "string" && v[1].length <= HISTORY_STRING_CHARS) {
        stringChars += v[1].length;
        if (decoded) parts.push(v[1]);
      } else if (v[0] === "endString" && v.length === 1 && stringChars === string.length) {
        string.end = frame.end;
        index.strings.set(string.id, string);
        decoded?.strings.set(string.id, parts.join(""));
        string = undefined;
      } else throw new SessionHistoryError("Invalid chunked history string");
    } else if (row) {
      if (v[0] === "endRow" && v.length === 1) {
        row.range.end = frame.end;
        (row.kind === "message" ? index.messages : index.tools).set(row.index, row.range);
        if (decoded) {
          const values = row.kind === "message" ? decoded.messages : decoded.tools;
          values.set(row.index, decodeRow(tokens, row.range.digest, decoded));
        }
        row = undefined;
      } else if (!["null", "bool", "number", "ref", "array", "object"].includes(v[0] as string))
        throw new SessionHistoryError("Invalid history value token");
      else if (decoded) tokens.push(v);
    } else if (v[0] === "string" && v.length === 3 && integer(v[1]) && integer(v[2]) && !index.strings.has(v[1])) {
      string = { id: v[1], length: v[2], start: frame.start, end: 0 };
      stringChars = 0;
      parts = [];
    } else if (
      (v[0] === "message" || v[0] === "tool") &&
      v.length === 3 &&
      integer(v[1]) &&
      typeof v[2] === "string" &&
      /^[a-f0-9]{64}$/.test(v[2])
    ) {
      row = { kind: v[0], index: v[1], range: { start: frame.start, end: 0, digest: v[2] } };
      tokens = [];
    } else if (v[0] === "commit" && v.length === 6 && v.slice(1).every(integer)) {
      for (const [rows, values, count] of [
        [index.messages, decoded?.messages, v[2]],
        [index.tools, decoded?.tools, v[3]],
      ] as const) {
        if ((count as number) > rows.size) throw new SessionHistoryError("Missing committed history rows");
        for (const key of rows.keys()) {
          if (key < (count as number)) continue;
          rows.delete(key);
          values?.delete(key);
        }
        if (rows.size !== count) throw new SessionHistoryError("Noncontiguous committed history rows");
      }
    } else throw new SessionHistoryError("Unknown history record");
    last = v;
  }
  if (string || row || JSON.stringify(last) !== JSON.stringify(historyCommitFrame(head)))
    throw new SessionHistoryError("Committed history terminal record mismatch");
  return index;
}

/**
 * Decode and verify a row while the scan still interleaves with file reads, so a large history
 * never verifies in one long synchronous stretch.
 */
function decodeRow(tokens: unknown[][], digest: string, decoded: DecodedJournal): DecodedRow {
  try {
    const value = buildRowValue(tokens, decoded.strings);
    if (valueDigest(value) === digest) return { value };
  } catch {
    // Handled below: the row is only invalid if it is still committed when the scan ends.
  }
  // Writers emit strings before the rows that use them, and superseded rows need not be valid.
  // Keep the tokens so the final pass decodes this row, or reports its error, only if it is live.
  return { tokens };
}

/** Rebuild one row from its value tokens, synchronously and without recursion. */
function buildRowValue(tokens: unknown[][], strings: Map<number, string>): JsonValue {
  const open: { container: JsonValue[] | Record<string, JsonValue>; remaining: number; key?: string }[] = [];
  let result: { value: JsonValue } | undefined;
  for (const v of tokens) {
    if (result) throw new SessionHistoryError("History row content mismatch");
    let value: JsonValue;
    if (v[0] === "null" && v.length === 1) value = null;
    else if (v[0] === "bool" && v.length === 2 && typeof v[1] === "boolean") value = v[1];
    else if (v[0] === "number" && v.length === 2 && typeof v[1] === "number" && Number.isFinite(v[1])) value = v[1];
    else if (v[0] === "ref" && v.length === 2 && integer(v[1])) {
      const text = strings.get(v[1]);
      if (text === undefined) throw new SessionHistoryError("Missing history string");
      value = text;
    } else if ((v[0] === "array" || v[0] === "object") && v.length === 2 && integer(v[1])) {
      const container = v[0] === "array" ? [] : {};
      if (v[1] > 0) {
        open.push({ container, remaining: v[1] });
        continue;
      }
      value = container;
    } else throw new SessionHistoryError("Invalid history container");

    // Attach the finished value to its parent, closing every parent it completes.
    for (;;) {
      const parent = open.at(-1);
      if (!parent) {
        result = { value };
        break;
      }
      if (Array.isArray(parent.container)) parent.container.push(value);
      else if (parent.key === undefined) {
        if (typeof value !== "string" || Object.hasOwn(parent.container, value))
          throw new SessionHistoryError("Invalid history object key");
        parent.key = value;
        break;
      } else {
        Object.defineProperty(parent.container, parent.key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        parent.key = undefined;
      }
      if (--parent.remaining > 0) break;
      open.pop();
      value = parent.container;
    }
  }
  if (!result) throw new SessionHistoryError("Incomplete history value");
  return result.value;
}

/** One sequential pass; returns only the committed rows (obsolete values are dropped) and never populates writer caches. */
export async function readSessionHistory(
  dir: string,
  sessionId: string,
  head: HistoryReference,
): Promise<{ messages: JsonValue[]; tools: JsonValue[] }> {
  try {
    const path = historyPath(dir, sessionId, head.generation);
    const decoded: DecodedJournal = { strings: new Map(), messages: new Map(), tools: new Map() };
    const index = await indexJournal(path, sessionId, head, decoded);
    const rows = (ranges: Map<number, RowRange>, values: Map<number, DecodedRow>, count: number): JsonValue[] =>
      Array.from({ length: count }, (_, i) => {
        const row = values.get(i)!;
        if ("value" in row) return row.value;
        const value = buildRowValue(row.tokens, decoded.strings);
        if (valueDigest(value) !== ranges.get(i)!.digest) throw new SessionHistoryError("History row content mismatch");
        return value;
      });
    return {
      messages: rows(index.messages, decoded.messages, head.messageCount),
      tools: rows(index.tools, decoded.tools, head.toolCount),
    };
  } catch (cause) {
    throw new SessionHistoryError(`Cannot reconstruct committed history for ${sessionId}`, { cause });
  }
}

/** Verify a staged generation without materializing its conversation or large strings. */
export async function verifySessionHistory(dir: string, sessionId: string, head: HistoryReference): Promise<string[]> {
  const path = historyPath(dir, sessionId, head.generation);
  const index = await indexJournal(path, sessionId, head);
  const digests: string[] = [];
  for (const [rows, count] of [
    [index.messages, head.messageCount],
    [index.tools, head.toolCount],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const range = rows.get(i)!;
      const hash = createHash("sha256");
      for await (const { value } of historyFrames(path, range)) {
        if (["message", "tool", "endRow"].includes(value[0] as string)) continue;
        if (value[0] !== "ref") {
          hash.update(JSON.stringify(value) + "\n");
          continue;
        }
        const string = index.strings.get(value[1] as number);
        if (!string) throw new SessionHistoryError("Missing staged string");
        hash.update(`s${string.length}:`);
        for await (const part of historyFrames(path, string))
          if (part.value[0] === "part") hash.update(Buffer.from(part.value[1] as string, "utf16le"));
        hash.update('["ref",0]\n');
      }
      const digest = hash.digest("hex");
      if (digest !== range.digest) throw new SessionHistoryError("Staged history content mismatch");
      digests.push(digest);
    }
  }
  return digests;
}

/** One instance per store. Call only while holding the store's per-session queue. */
export class SessionHistoryJournal {
  private caches = new Map<string, JournalCache>();
  constructor(private dir: string) {}

  release(sessionId: string): void {
    this.caches.delete(sessionId);
  }

  async write(
    sessionId: string,
    messages: JsonValue[],
    tools: JsonValue[],
    frozenCount: number,
    frozenToolCount: number,
    publish: (head: HistoryReference) => Promise<void>,
    priorHead?: HistoryReference,
  ): Promise<HistoryReference> {
    if (priorHead) {
      validateHistoryReference(priorHead);
      historyPath(this.dir, sessionId, priorHead.generation);
    }
    const previous = this.caches.get(sessionId);
    let candidate: JournalCache | undefined;
    const created: string[] = [];
    try {
      candidate = await this.append(sessionId, messages, tools, frozenCount, frozenToolCount, previous, created);
      const live = [...candidate.strings.values(), ...candidate.messages, ...candidate.tools].reduce(
        (sum, r) => sum + r.end - r.start,
        0,
      );
      if (previous && candidate.head.bytes - live > live) {
        await this.rollback(sessionId, previous.head);
        candidate = await this.append(sessionId, messages, tools, frozenCount, frozenToolCount, undefined, created);
      }
      await publish(candidate.head);
    } catch (error) {
      if (previous) {
        try {
          await this.rollback(sessionId, previous.head);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Cannot restore committed history extent");
        }
      }
      for (const path of created) await removeCandidate(path);
      throw error;
    }
    this.caches.set(sessionId, candidate);
    // Readers share the same queue, so no reader can still hold the retired generation.
    const retired = previous?.head ?? priorHead;
    if (retired && retired.generation !== candidate.head.generation)
      await removeCandidate(historyPath(this.dir, sessionId, retired.generation));
    return candidate.head;
  }

  private async rollback(sessionId: string, head: HistoryReference): Promise<void> {
    const file = await open(historyPath(this.dir, sessionId, head.generation), "r+");
    try {
      await file.truncate(head.bytes);
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async append(
    sessionId: string,
    messages: JsonValue[],
    tools: JsonValue[],
    frozenCount: number,
    frozenToolCount: number,
    previous: JournalCache | undefined,
    created: string[],
  ): Promise<JournalCache> {
    const generation = previous?.head.generation ?? randomUUID();
    const path = historyPath(this.dir, sessionId, generation);
    const strings = new Map<string, StringRange>();
    let nextId = previous?.nextId ?? 0;
    const rows = [messages, tools].map((values) =>
      values.map((value) => {
        for (const _ of valueTokens(value, (text) => {
          if (!strings.has(text))
            strings.set(text, previous?.strings.get(text) ?? { id: nextId++, length: text.length, start: 0, end: 0 });
          return strings.get(text)!.id;
        })) {
          /* Discover only this candidate's references, including unchanged rows. */
        }
        return { value, digest: valueDigest(value) };
      }),
    );
    const file = await open(path, previous ? "r+" : "wx", 0o600);
    if (!previous) created.push(path);
    const writer = new HistoryFrameWriter(file, previous?.head.bytes ?? 0);
    try {
      if (previous) await file.truncate(previous.head.bytes);
      else await writer.frame(["history", 1, sessionId, generation]);
      for (const [text, range] of strings) {
        if (range.end) continue;
        range.start = writer.position;
        for (const frame of stringFrames(range.id, text)) await writer.frame(frame);
        range.end = writer.position;
      }
      const resultRows: RowRange[][] = [[], []];
      for (let kind = 0; kind < 2; kind++) {
        const old = kind === 0 ? previous?.messages : previous?.tools;
        for (let i = 0; i < rows[kind].length; i++) {
          const row = rows[kind][i];
          if (old?.[i]?.digest === row.digest) {
            resultRows[kind].push(old[i]);
            continue;
          }
          const start = writer.position;
          await writer.frame([kind === 0 ? "message" : "tool", i, row.digest]);
          for (const token of valueTokens(row.value, (text) => strings.get(text)!.id)) await writer.frame(token);
          await writer.frame(["endRow"]);
          resultRows[kind].push({ start, end: writer.position, digest: row.digest });
        }
      }
      const head: HistoryReference = {
        version: 1,
        generation,
        bytes: 0,
        revision: (previous?.head.revision ?? 0) + 1,
        messageCount: messages.length,
        toolCount: tools.length,
        frozenCount,
        frozenToolCount,
      };
      await writer.frame(historyCommitFrame(head));
      head.bytes = writer.position;
      await writer.flush();
      await file.sync();
      return { head, strings, messages: resultRows[0], tools: resultRows[1], nextId };
    } finally {
      await file.close();
    }
  }
}

export class HistoryFrameWriter {
  private pending: string[] = [];
  private size = 0;
  constructor(
    private file: FileHandle,
    public position: number,
  ) {}
  async frame(value: unknown[]): Promise<void> {
    const text = JSON.stringify(value) + "\n";
    this.pending.push(text);
    this.size += Buffer.byteLength(text);
    this.position += Buffer.byteLength(text);
    if (this.size >= 64 * 1024) await this.flush();
  }
  async flush(): Promise<void> {
    if (!this.size) return;
    const buffer = Buffer.from(this.pending.join(""));
    let written = 0;
    while (written < buffer.length) {
      const { bytesWritten } = await this.file.write(
        buffer,
        written,
        buffer.length - written,
        this.position - this.size + written,
      );
      if (!bytesWritten) throw new Error("History write made no progress");
      written += bytesWritten;
    }
    this.pending = [];
    this.size = 0;
  }
}

async function removeCandidate(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn(`[session-store] Retained unused history generation ${path}:`, error);
  }
}
