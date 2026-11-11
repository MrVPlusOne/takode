import { createHash, randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  HISTORY_FRAME_BYTES,
  HISTORY_STRING_CHARS,
  rowLines,
  textDigest,
  valueDigest,
  valueLineText,
  type JsonValue,
} from "./session-history-codec.js";

/**
 * The committed state of a session's history file. Version 1 files spell every value out as typed
 * tokens with shared strings and are only read now; version 2 files, which every save writes, keep
 * each row as its JSON text and read about four times faster. A session's file turns into version 2
 * at its first save after a server start, which writes a fresh file anyway.
 */
export interface HistoryReference {
  version: 1 | 2;
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
/** What this process wrote last to a session's version 2 file, or read from it before writing. */
interface JournalCache {
  head: HistoryReference;
  messages: RowRange[];
  tools: RowRange[];
}
/** The committed rows of a history file, as a read found them. */
export type CommittedRows = JournalCache;
export type RowSpan = [start: number, end: number];
/** Leading rows the caller has not changed since its last save; they are live objects, not captured copies. */
export interface UnchangedHistoryPrefix {
  messages: number;
  tools: number;
  /** Ranges `[start, end)` inside the prefix that are read and compared anyway, to catch edits nobody reported. */
  recheck?: { messages: RowSpan[]; tools: RowSpan[] };
}
interface JournalIndex {
  strings: Map<number, StringRange>;
  messages: Map<number, RowRange>;
  tools: Map<number, RowRange>;
}
/**
 * A row is decoded when its record ends. A version 1 row that does not decode yet keeps its tokens
 * until the scan ends; a version 2 row whose text does not match its digest is invalid. Either fails
 * the read only if the row is still committed.
 */
type DecodedRow = { value: JsonValue } | { tokens: unknown[][] } | { invalid: true };
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
    (value.version !== 1 && value.version !== 2) ||
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

interface HistoryFrame {
  value: unknown[];
  start: number;
  end: number;
  bytes: Buffer;
}

/** Bytes read from a history file at a time. */
const HISTORY_READ_BYTES = 1024 * 1024;

/** Scan bounded frames in an exact byte range; partial lines never count as committed data. */
export async function* historyFrames(path: string, range: Range): AsyncGenerator<HistoryFrame> {
  for await (const batch of historyFrameBatches(path, range)) yield* batch;
}

/**
 * The frames of an exact byte range, a read's worth at a time. Startup reads every active session's
 * whole history, so reads are large and their frames are handed over together: going through an async
 * generator per frame, and joining every small stream chunk onto the unfinished line, took about as
 * long as parsing the history itself. Yields to the event loop between reads every ~20 ms.
 */
async function* historyFrameBatches(path: string, range: Range): AsyncGenerator<HistoryFrame[]> {
  const file = await open(path, "r");
  let carry = Buffer.alloc(0);
  let offset = range.start;
  let position = range.start;
  let sliceStart = performance.now();
  try {
    while (position < range.end) {
      const want = Math.min(HISTORY_READ_BYTES, range.end - position);
      const data = Buffer.allocUnsafe(carry.length + want);
      carry.copy(data, 0);
      const { bytesRead } = await file.read(data, carry.length, want, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const filled = data.subarray(0, carry.length + bytesRead);
      const frames: HistoryFrame[] = [];
      let start = 0;
      for (;;) {
        const newline = filled.indexOf(10, start);
        if (newline < 0) break;
        if (newline - start > HISTORY_FRAME_BYTES) throw new SessionHistoryError("Oversized history frame");
        const bytes = filled.subarray(start, newline);
        const value: unknown = JSON.parse(bytes.toString("utf8"));
        if (!Array.isArray(value)) throw new SessionHistoryError("Invalid history frame");
        const end = offset + newline + 1 - start;
        frames.push({ value, start: offset, end, bytes });
        offset = end;
        start = newline + 1;
      }
      // The unfinished line is copied, so a batch's frames don't keep the whole read alive.
      carry = Buffer.from(filled.subarray(start));
      if (carry.length > HISTORY_FRAME_BYTES) throw new SessionHistoryError("Oversized history frame");
      if (frames.length) yield frames;
      if (performance.now() - sliceStart > HISTORY_SCAN_SLICE_MS) {
        await new Promise((resolve) => setImmediate(resolve));
        sliceStart = performance.now();
      }
    }
    if (carry.length || offset !== range.end) throw new SessionHistoryError("Incomplete committed history extent");
  } finally {
    await file.close();
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
  // A version 2 row's body: its one value line, or the pieces of its JSON text.
  let body: { kind: "value"; row: DecodedRow } | { kind: "text"; pieces: string[] } | undefined;
  let last: unknown[] = [];
  let first = true;
  /** The highest row index set since the last commit dropped the rows past its count. */
  const highest = { messages: -1, tools: -1 };
  for await (const batch of historyFrameBatches(path, { start: 0, end: head.bytes }))
    for (const frame of batch) {
      const v = frame.value;
      if (first) {
        first = false;
        if (JSON.stringify(v) !== JSON.stringify(["history", head.version, sessionId, head.generation]))
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
          const kind = row.kind === "message" ? "messages" : "tools";
          highest[kind] = Math.max(highest[kind], row.index);
          if (decoded) {
            const values = row.kind === "message" ? decoded.messages : decoded.tools;
            values.set(
              row.index,
              head.version === 1 ? decodeRow(tokens, row.range.digest, decoded) : decodeBody(body, row.range.digest),
            );
          }
          row = undefined;
        } else if (head.version === 2) {
          if (v[0] === "value" && v.length === 2 && !body) {
            body = {
              kind: "value",
              row: decoded ? valueRow(v[1] as JsonValue, frame.bytes, row.range.digest) : INVALID,
            };
          } else if (
            v[0] === "text" &&
            v.length === 2 &&
            typeof v[1] === "string" &&
            v[1].length <= HISTORY_STRING_CHARS &&
            body?.kind !== "value"
          ) {
            body ??= { kind: "text", pieces: [] };
            if (decoded) body.pieces.push(v[1]);
          } else throw new SessionHistoryError("Invalid history row record");
        } else if (!["null", "bool", "number", "ref", "array", "object"].includes(v[0] as string))
          throw new SessionHistoryError("Invalid history value token");
        else if (decoded) tokens.push(v);
      } else if (
        head.version === 1 &&
        v[0] === "string" &&
        v.length === 3 &&
        integer(v[1]) &&
        integer(v[2]) &&
        !index.strings.has(v[1])
      ) {
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
        body = undefined;
      } else if (v[0] === "commit" && v.length === 6 && v.slice(1).every(integer)) {
        for (const [kind, rows, values, count] of [
          ["messages", index.messages, decoded?.messages, v[2]],
          ["tools", index.tools, decoded?.tools, v[3]],
        ] as const) {
          if ((count as number) > rows.size) throw new SessionHistoryError("Missing committed history rows");
          // Only rows past the commit's count are dropped. Walking every row on each commit made a read
          // grow with commits times rows, and a long-running session's file holds a commit per save.
          for (let key = count as number; key <= highest[kind]; key++) {
            rows.delete(key);
            values?.delete(key);
          }
          highest[kind] = Math.min(highest[kind], (count as number) - 1);
          if (rows.size !== count) throw new SessionHistoryError("Noncontiguous committed history rows");
        }
      } else throw new SessionHistoryError("Unknown history record");
      last = v;
    }
  if (string || row || JSON.stringify(last) !== JSON.stringify(historyCommitFrame(head)))
    throw new SessionHistoryError("Committed history terminal record mismatch");
  return index;
}

const INVALID: DecodedRow = { invalid: true };

/** A version 2 row held whole in its value line, checked against the line's own bytes. */
function valueRow(value: JsonValue, line: Uint8Array, digest: string): DecodedRow {
  const text = valueLineText(line) ?? Buffer.from(JSON.stringify(value));
  return textDigest(text) === digest ? { value } : INVALID;
}

/** A version 2 row once its record ends: its value line, or its text pieces joined and parsed. */
function decodeBody(
  body: { kind: "value"; row: DecodedRow } | { kind: "text"; pieces: string[] } | undefined,
  digest: string,
): DecodedRow {
  if (!body) return INVALID;
  if (body.kind === "value") return body.row;
  const text = body.pieces.join("");
  if (textDigest(text) !== digest) return INVALID;
  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch {
    return INVALID;
  }
}

/**
 * Decode and verify a version 1 row while the scan still interleaves with file reads, so a large
 * history never verifies in one long synchronous stretch.
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
  options: {
    /** Receives the committed rows' positions and digests, so a writer can append to the file it read. */
    onCommittedRows?: (rows: CommittedRows) => void;
  } = {},
): Promise<{ messages: JsonValue[]; tools: JsonValue[] }> {
  try {
    const path = historyPath(dir, sessionId, head.generation);
    const decoded: DecodedJournal = { strings: new Map(), messages: new Map(), tools: new Map() };
    const index = await indexJournal(path, sessionId, head, decoded);
    options.onCommittedRows?.({
      head,
      messages: Array.from({ length: head.messageCount }, (_, i) => index.messages.get(i)!),
      tools: Array.from({ length: head.toolCount }, (_, i) => index.tools.get(i)!),
    });
    const rows = (ranges: Map<number, RowRange>, values: Map<number, DecodedRow>, count: number): JsonValue[] =>
      Array.from({ length: count }, (_, i) => {
        const row = values.get(i)!;
        if ("value" in row) return row.value;
        if ("invalid" in row) throw new SessionHistoryError("History row content mismatch");
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
      // A version 2 row's text pieces may split a surrogate pair, so they are joined before hashing.
      const pieces: string[] = [];
      for await (const { value, bytes } of historyFrames(path, range)) {
        if (head.version === 2) {
          if (value[0] === "value") hash.update(valueLineText(bytes) ?? JSON.stringify(value[1]));
          else if (value[0] === "text") pieces.push(value[1] as string);
          continue;
        }
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
      if (pieces.length) hash.update(pieces.join(""));
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

  /**
   * Takes the committed rows of a version 2 file a read just verified, unless this process already
   * writes the session. The first save after a restart then appends to that file instead of
   * serializing, hashing and rewriting every row of the history into a new one.
   */
  adoptCommittedRows(sessionId: string, rows: CommittedRows): void {
    if (rows.head.version !== 2 || this.caches.has(sessionId)) return;
    this.caches.set(sessionId, rows);
  }

  /**
   * Appends the rows that changed since the cached committed state and publishes the new head.
   * Rows below `unchanged` are live objects the caller promises have not changed since its last save;
   * rows inside the committed frozen prefix are then reused without being read. `onTurn` is called
   * wherever the write resumes after waiting, so the caller can time how long it holds the event loop.
   */
  async write(
    sessionId: string,
    messages: JsonValue[],
    tools: JsonValue[],
    frozenCount: number,
    frozenToolCount: number,
    publish: (head: HistoryReference) => Promise<void>,
    priorHead?: HistoryReference,
    { unchanged = { messages: 0, tools: 0 }, onTurn }: { unchanged?: UnchangedHistoryPrefix; onTurn?: () => void } = {},
  ): Promise<HistoryReference> {
    if (priorHead) {
      validateHistoryReference(priorHead);
      historyPath(this.dir, sessionId, priorHead.generation);
    }
    const previous = this.caches.get(sessionId);
    let candidate: JournalCache | undefined;
    const created: string[] = [];
    try {
      const rows = { messages, tools, frozenCount, frozenToolCount, unchanged, onTurn };
      candidate = await this.append(sessionId, rows, previous, created);
      if (previous && candidate.head.bytes - liveBytes(candidate) > liveBytes(candidate)) {
        await this.rollback(sessionId, previous.head);
        candidate = await this.append(sessionId, rows, undefined, created);
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
    rows: CandidateRows,
    previous: JournalCache | undefined,
    created: string[],
  ): Promise<JournalCache> {
    const generation = previous?.head.generation ?? randomUUID();
    const path = historyPath(this.dir, sessionId, generation);
    const values = [rows.messages, rows.tools];
    const old = [previous?.messages ?? [], previous?.tools ?? []];
    // Rows the caller reports unchanged since its last save are reused without being read: re-digesting a
    // large session's whole history on every save blocked the event loop for over a second. Repairs pass
    // no unchanged rows.
    const trusted = [0, 1].map((k) =>
      Math.min(k === 0 ? rows.unchanged.messages : rows.unchanged.tools, old[k].length, values[k].length),
    );
    const recheck = [rows.unchanged.recheck?.messages ?? [], rows.unchanged.recheck?.tools ?? []];
    const isRead = (kind: number, i: number) =>
      i >= trusted[kind] || recheck[kind].some(([start, end]) => i >= start && i < end);
    // A row's JSON text is both what is written and, hashed, its identity. Text taken here is also
    // the save's snapshot of rows the caller still holds live.
    const candidates: { text: string; digest: string }[][] = [[], []];
    let sliceStart = performance.now();
    for (let kind = 0; kind < 2; kind++) {
      const spans: RowSpan[] = [...recheck[kind], [trusted[kind], values[kind].length]];
      for (const [start, end] of spans) {
        for (let i = Math.max(0, start); i < Math.min(end, values[kind].length); i++) {
          if (candidates[kind][i]) continue;
          if (performance.now() - sliceStart > HISTORY_SCAN_SLICE_MS) {
            await new Promise((resolve) => setImmediate(resolve));
            rows.onTurn?.();
            sliceStart = performance.now();
          }
          const text = JSON.stringify(values[kind][i]) ?? "null";
          candidates[kind][i] = { text, digest: textDigest(text) };
        }
      }
    }
    const file = await open(path, previous ? "r+" : "wx", 0o600);
    rows.onTurn?.();
    if (!previous) created.push(path);
    const writer = new HistoryFrameWriter(file, previous?.head.bytes ?? 0, rows.onTurn);
    try {
      if (previous) {
        await file.truncate(previous.head.bytes);
        rows.onTurn?.();
      } else await writer.frame(["history", 2, sessionId, generation]);
      const resultRows: RowRange[][] = [[], []];
      for (let kind = 0; kind < 2; kind++) {
        for (let i = 0; i < values[kind].length; i++) {
          const saved = old[kind][i];
          if (!isRead(kind, i)) {
            resultRows[kind].push(saved);
            continue;
          }
          const row = candidates[kind][i];
          if (saved?.digest === row.digest) {
            resultRows[kind].push(saved);
            continue;
          }
          const start = writer.position;
          await writer.frame([kind === 0 ? "message" : "tool", i, row.digest]);
          for (const line of rowLines(row.text)) await writer.line(line);
          await writer.frame(["endRow"]);
          resultRows[kind].push({ start, end: writer.position, digest: row.digest });
        }
      }
      const head: HistoryReference = {
        version: 2,
        generation,
        bytes: 0,
        revision: (previous?.head.revision ?? 0) + 1,
        messageCount: rows.messages.length,
        toolCount: rows.tools.length,
        frozenCount: rows.frozenCount,
        frozenToolCount: rows.frozenToolCount,
      };
      await writer.frame(historyCommitFrame(head));
      head.bytes = writer.position;
      await writer.flush();
      await file.sync();
      return { head, messages: resultRows[0], tools: resultRows[1] };
    } finally {
      await file.close();
    }
  }
}

interface CandidateRows {
  messages: JsonValue[];
  tools: JsonValue[];
  frozenCount: number;
  frozenToolCount: number;
  unchanged: UnchangedHistoryPrefix;
  onTurn?: () => void;
}

function rangeBytes(ranges: Iterable<Range>): number {
  let bytes = 0;
  for (const range of ranges) bytes += range.end - range.start;
  return bytes;
}

/** Saved bytes still referenced by the committed state; the rest of the generation is obsolete. */
function liveBytes(cache: JournalCache): number {
  return rangeBytes(cache.messages) + rangeBytes(cache.tools);
}

export class HistoryFrameWriter {
  private pending: string[] = [];
  private size = 0;
  constructor(
    private file: FileHandle,
    public position: number,
    /** Called after each write completes, where the writer resumes on a new event-loop turn. */
    private onTurn?: () => void,
  ) {}
  async frame(value: unknown[]): Promise<void> {
    await this.line(JSON.stringify(value) + "\n");
  }
  /** Writes one frame line already serialized, newline included. */
  async line(text: string): Promise<void> {
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
      this.onTurn?.();
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
