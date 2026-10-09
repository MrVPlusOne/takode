// Parsing support used only by the one-use offline experimental-tail converter.
import { lstat, open, type FileHandle } from "node:fs/promises";

export interface JsonRange {
  start: number;
  end: number;
}
export interface StringNode extends JsonRange {
  kind: "string";
  chars: number;
}
export type SourceNode =
  | StringNode
  | ({ kind: "array"; items: SourceNode[] } & JsonRange)
  | ({ kind: "object"; entries: [StringNode, SourceNode][] } & JsonRange)
  | ({ kind: "scalar"; value: null | boolean | number } & JsonRange);

const SIMPLE_ESCAPES: Record<number, string> = {
  34: '"',
  92: "\\",
  47: "/",
  98: "\b",
  102: "\f",
  110: "\n",
  114: "\r",
  116: "\t",
};

/** Byte-indexed JSON reader. Strings are validated in pieces and represented by file ranges. */
export class SourceJson {
  private buffer = Buffer.alloc(0);
  private bufferStart = 0;
  position: number;
  constructor(
    readonly file: FileHandle,
    readonly end: number,
    start = 0,
  ) {
    this.position = start;
  }

  static async open(path: string, end?: number): Promise<SourceJson> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Source must be a regular file");
    const file = await open(path, "r");
    return new SourceJson(file, end ?? (await file.stat()).size);
  }
  /**
   * The byte at the cursor when it is already buffered (-1 at the end), else undefined.
   * Hot loops use `buffered() ?? (await peek())` so buffered bytes cost no promise.
   */
  private buffered(): number | undefined {
    if (this.position >= this.end) return -1;
    const offset = this.position - this.bufferStart;
    return offset >= 0 && offset < this.buffer.length ? this.buffer[offset] : undefined;
  }
  async peek(): Promise<number> {
    const byte = this.buffered();
    if (byte !== undefined) return byte;
    const buffer = Buffer.alloc(Math.min(64 * 1024, this.end - this.position));
    const { bytesRead } = await this.file.read(buffer, 0, buffer.length, this.position);
    if (!bytesRead) throw new Error("Source ended before its declared extent");
    this.buffer = buffer.subarray(0, bytesRead);
    this.bufferStart = this.position;
    return this.buffer[0];
  }
  async whitespace(): Promise<void> {
    while ([32, 9, 10, 13].includes(this.buffered() ?? (await this.peek()))) this.position++;
  }
  async expect(byte: number): Promise<void> {
    await this.whitespace();
    if ((await this.peek()) !== byte) throw new Error(`Invalid source JSON at byte ${this.position}`);
    this.position++;
  }

  async *stringParts(): AsyncGenerator<string> {
    await this.expect(34);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let pending = "";
    for (;;) {
      const byte = this.buffered() ?? (await this.peek());
      if (byte < 0) throw new Error("Incomplete source JSON string");
      if (byte === 34) {
        this.position++;
        pending += decoder.decode();
        if (pending) yield pending;
        return;
      }
      if (byte === 92) {
        pending += decoder.decode();
        this.position++;
        const escape = this.buffered() ?? (await this.peek());
        this.position++;
        if (escape === 117) {
          let code = 0;
          for (let i = 0; i < 4; i++) {
            const digit = hexDigit(this.buffered() ?? (await this.peek()));
            if (digit < 0) throw new Error("Invalid source Unicode escape");
            code = code * 16 + digit;
            this.position++;
          }
          pending += String.fromCharCode(code);
        } else if (Object.hasOwn(SIMPLE_ESCAPES, escape)) pending += SIMPLE_ESCAPES[escape];
        else throw new Error("Invalid source JSON escape");
      } else {
        const start = this.position - this.bufferStart;
        let end = start;
        while (end < this.buffer.length && this.buffer[end] !== 34 && this.buffer[end] !== 92) {
          if (this.buffer[end] < 32) throw new Error("Unescaped source JSON control character");
          end++;
        }
        pending += decoder.decode(this.buffer.subarray(start, end), { stream: true });
        this.position += end - start;
      }
      while (pending.length >= 16 * 1024) {
        yield pending.slice(0, 16 * 1024);
        pending = pending.slice(16 * 1024);
      }
    }
  }

  /** With capture=false, validate a value without retaining its container tree. */
  async value(capture = true): Promise<SourceNode> {
    await this.whitespace();
    const start = this.position,
      byte = await this.peek();
    if (byte === 34) {
      let chars = 0;
      for await (const part of this.stringParts()) chars += part.length;
      return { kind: "string", start, end: this.position, chars };
    }
    if (byte === 91) {
      this.position++;
      const items: SourceNode[] = [];
      await this.whitespace();
      if ((await this.peek()) !== 93)
        for (;;) {
          const node = await this.value(capture);
          if (capture) items.push(node);
          await this.whitespace();
          if ((await this.peek()) !== 44) break;
          this.position++;
        }
      await this.expect(93);
      return { kind: "array", start, end: this.position, items };
    }
    if (byte === 123) {
      this.position++;
      const entries: [StringNode, SourceNode][] = [];
      await this.whitespace();
      if ((await this.peek()) !== 125)
        for (;;) {
          const key = await this.value(capture);
          if (key.kind !== "string") throw new Error("Source object key is not a string");
          await this.expect(58);
          const node = await this.value(capture);
          if (capture) entries.push([key, node]);
          await this.whitespace();
          if ((await this.peek()) !== 44) break;
          this.position++;
        }
      await this.expect(125);
      return { kind: "object", start, end: this.position, entries };
    }
    let token = "";
    while (![-1, 32, 9, 10, 13, 44, 93, 125].includes(await this.peek())) {
      token += String.fromCharCode(await this.peek());
      this.position++;
      if (token.length > 1024) throw new Error("Invalid source scalar");
    }
    if (!/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token))
      throw new Error("Invalid source scalar");
    const value = JSON.parse(token) as null | boolean | number;
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Nonfinite source number");
    return { kind: "scalar", start, end: this.position, value };
  }

  async at(range: JsonRange): Promise<SourceNode> {
    const cursor = new SourceJson(this.file, range.end, range.start);
    const node = await cursor.value();
    await cursor.whitespace();
    if (cursor.position !== range.end) throw new Error("Extra source value bytes");
    return node;
  }
  async text(node: StringNode, maxChars = 4096): Promise<string> {
    if (node.chars > maxChars) throw new Error("Oversized source control field");
    let result = "";
    for await (const part of this.parts(node)) result += part;
    return result;
  }
  async *parts(node: StringNode): AsyncGenerator<string> {
    yield* new SourceJson(this.file, node.end, node.start).stringParts();
  }
  async fields(node: SourceNode): Promise<Map<string, SourceNode>> {
    if (node.kind !== "object") throw new Error("Expected source object");
    const result = new Map<string, SourceNode>();
    // This is a bounded control-field index, not the complete payload. Callers
    // preserve arbitrary keys through the original object entries/ranges.
    for (const [key, value] of node.entries) {
      if (key.chars > 4096) continue;
      const name = await this.text(key);
      if (result.has(name)) throw new Error("Duplicate source metadata key");
      result.set(name, value);
    }
    return result;
  }
  async small(node: SourceNode): Promise<unknown> {
    if (node.kind === "string") return this.text(node);
    if (node.kind === "scalar") return node.value;
    if (node.kind === "array") return Promise.all(node.items.map((n) => this.small(n)));
    const result: Record<string, unknown> = {};
    for (const [key, child] of node.entries)
      Object.defineProperty(result, await this.text(key), { value: await this.small(child), enumerable: true });
    return result;
  }
}

/** Value of an ASCII hex digit byte, or -1. */
function hexDigit(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}
