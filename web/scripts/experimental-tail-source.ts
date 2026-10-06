// Exceptional compatibility code for the one-use converter. Never import from the server.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SourceJson, type JsonRange, type SourceNode, type StringNode } from "./experimental-tail-json.js";

export interface SourceRow {
  source: SourceJson;
  range: JsonRange;
  encoded: boolean;
}
export interface SourceString {
  source: SourceJson;
  node: StringNode;
  drop: number;
  identity: string;
}
export class ExperimentalTailSource {
  readonly strings = new Map<number, StringNode>();
  messages: SourceRow[] = [];
  tools: SourceRow[] = [];
  frozenCount = 0;
  frozenTools = 0;
  private sources: SourceJson[] = [];
  private journal?: SourceJson;
  private constructor(
    readonly id: string,
    readonly hot: SourceJson,
    readonly fields: Map<string, SourceNode>,
    readonly metadata: [StringNode, SourceNode][],
  ) {
    this.sources.push(hot);
  }

  static async inspect(dir: string, id: string): Promise<ExperimentalTailSource | null> {
    const hot = await SourceJson.open(join(dir, `${id}.json`));
    let result: ExperimentalTailSource | undefined;
    try {
      const node = await hot.value();
      await hot.whitespace();
      if (hot.position !== hot.end) throw new Error("Extra hot JSON data");
      // Launcher/catalog JSON can be an array and is not a session tail bundle.
      if (node.kind !== "object") {
        await hot.file.close();
        return null;
      }
      const fields = await hot.fields(node);
      if (!fields.has("_tailJournal")) {
        await hot.file.close();
        return null;
      }
      if (!fields.has("id") || (await hot.small(fields.get("id")!)) !== id || !fields.has("state"))
        throw new Error("Source session identity mismatch");
      if (fields.has("_historyRef")) throw new Error("Conflicting history formats");
      const ref = (await hot.small(fields.get("_tailJournal")!)) as Record<string, unknown>;
      if (!ref || ref.version !== 1 || !positive(ref.bytes) || !positive(ref.revision))
        throw new Error("Unsupported experimental tail reference");
      for (const name of ["messageHistory", "toolResults"]) {
        const inline = fields.get(name);
        if (inline && (inline.kind !== "array" || inline.items.length))
          throw new Error("Conflicting inline and journal tail");
      }
      result = new ExperimentalTailSource(id, hot, fields, node.kind === "object" ? node.entries : []);
      result.frozenCount = await result.count("_frozenCount");
      result.frozenTools = await result.count("_frozenToolResultCount");
      await result.indexJournal(dir, ref.bytes, ref.revision);
      await result.readFrozen(dir);
      return result;
    } catch (error) {
      if (result) await result.close();
      else await hot.file.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.sources.map((source) => source.file.close()));
  }
  private async count(field: string): Promise<number> {
    const node = this.fields.get(field);
    const value = node ? await this.hot.small(node) : 0;
    if (!nonnegative(value)) throw new Error(`Invalid ${field}`);
    return value;
  }
  private async indexJournal(dir: string, bytes: number, revision: number): Promise<void> {
    const source = await SourceJson.open(join(dir, `${this.id}.tail.jsonl`), bytes);
    this.journal = source;
    this.sources.push(source);
    const rows = { m: new Map<number, JsonRange>(), t: new Map<number, JsonRange>() };
    let commit: number[] | undefined;
    let lastWasCommit = false;
    while (source.position < bytes) {
      await source.expect(91);
      const tagNode = await source.value();
      if (tagNode.kind !== "string") throw new Error("Invalid journal record kind");
      const tag = await source.text(tagNode, 1);
      await source.expect(44);
      const id = await source.small(await source.value());
      if (!nonnegative(id)) throw new Error("Invalid journal row/string/revision id");
      lastWasCommit = tag === "c";
      if (tag === "c") {
        commit = [id];
        for (let i = 0; i < 4; i++) {
          await source.expect(44);
          const count = await source.small(await source.value());
          if (!nonnegative(count)) throw new Error("Invalid journal commit count");
          commit.push(count);
        }
      } else if (tag === "s" || tag === "m" || tag === "t") {
        await source.expect(44);
        const node = await source.value(false);
        if (tag === "s") {
          if (node.kind !== "string" || this.strings.has(id)) throw new Error("Invalid or repeated string definition");
          this.strings.set(id, node);
        } else rows[tag].set(id, node);
      } else throw new Error("Unknown journal record");
      await source.expect(93);
      // The committed extent ends after a whole JSONL record, not a partial commit.
      if ((await source.peek()) === 13) source.position++;
      if ((await source.peek()) !== 10) throw new Error("Incomplete journal record terminator");
      source.position++;
    }
    if (
      !lastWasCommit ||
      !commit ||
      commit[0] !== revision ||
      commit[1] !== this.frozenCount ||
      commit[3] !== this.frozenTools
    )
      throw new Error("Committed journal terminal/start mismatch");
    const select = (indexed: Map<number, JsonRange>, start: number, count: number): SourceRow[] => {
      if (count > indexed.size || !Number.isSafeInteger(start + count))
        throw new Error("Journal cardinality exceeds available rows");
      const selected: SourceRow[] = [];
      for (let i = 0; i < count; i++) {
        const range = indexed.get(start + i);
        if (!range) throw new Error("Missing committed journal row");
        selected.push({ source, range, encoded: true });
      }
      return selected;
    };
    this.messages = select(rows.m, commit[1], commit[2]);
    this.tools = select(rows.t, commit[3], commit[4]);
  }

  private async readFrozen(dir: string): Promise<void> {
    let source: SourceJson;
    try {
      source = await SourceJson.open(join(dir, `${this.id}.history.jsonl`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !this.frozenCount && !this.frozenTools) return;
      throw error;
    }
    this.sources.push(source);
    const header = (await source.small(await source.value())) as { v?: unknown; sessionId?: unknown };
    if (header?.v !== 1 || header.sessionId !== this.id) throw new Error("Frozen history identity/version mismatch");
    const messages: SourceRow[] = [],
      tools: SourceRow[] = [];
    await source.whitespace();
    while (source.position < source.end) {
      const node = await source.value();
      const fields = await source.fields(node);
      const results = fields.get("_toolResults");
      if (results) {
        if (results.kind !== "array" || node.kind !== "object" || node.entries.length !== 1)
          throw new Error("Invalid frozen tool-result record");
        for (const item of results.items) tools.push({ source, range: item, encoded: false });
      } else messages.push({ source, range: node, encoded: false });
      await source.whitespace();
    }
    const merge = async (frozen: SourceRow[], tail: SourceRow[], start: number): Promise<SourceRow[]> => {
      if (frozen.length < start || frozen.length > start + tail.length)
        throw new Error("Incomplete or trailing frozen prefix");
      for (let i = start; i < frozen.length; i++)
        if ((await this.digest(frozen[i])) !== (await this.digest(tail[i - start])))
          throw new Error("Conflicting frozen/journal overlap");
      return [...frozen.slice(0, start), ...tail];
    };
    this.messages = await merge(messages, this.messages, this.frozenCount);
    this.tools = await merge(tools, this.tools, this.frozenTools);
  }

  /** Resolve only value markers. Property names and dictionary contents are literal. */
  async string(source: SourceJson, node: StringNode, encoded: boolean): Promise<SourceString> {
    let drop = 0;
    if (encoded && node.chars) {
      const parts = source.parts(node);
      const first = await parts.next();
      await parts.return(undefined);
      const prefix = first.value ?? "";
      if (prefix.startsWith("\0\0")) drop = 1;
      else if (prefix.startsWith("\0")) {
        const marker = await source.text(node, 32);
        if (!/^\0(?:0|[1-9][0-9]*)$/.test(marker)) throw new Error("Invalid experimental string marker");
        const id = Number(marker.slice(1)),
          string = this.strings.get(id);
        if (!Number.isSafeInteger(id) || !string) throw new Error("Missing committed journal string");
        return { source: this.journal!, node: string, drop: 0, identity: `dictionary:${id}` };
      }
    }
    return { source, node, drop, identity: `${this.sources.indexOf(source)}:${node.start}:${drop}` };
  }

  async *parts(string: SourceString): AsyncGenerator<string> {
    let drop = string.drop;
    for await (const part of string.source.parts(string.node)) {
      const value = part.slice(drop);
      drop = Math.max(0, drop - part.length);
      if (value) yield value;
    }
  }

  async *tokens(row: SourceRow, register: (string: SourceString) => Promise<number>): AsyncGenerator<unknown[]> {
    const visit = async function* (
      this: ExperimentalTailSource,
      node: SourceNode,
      encoded: boolean,
    ): AsyncGenerator<unknown[]> {
      if (node.kind === "string") yield ["ref", await register(await this.string(row.source, node, encoded))];
      else if (node.kind === "scalar")
        yield node.value === null ? ["null"] : [typeof node.value === "boolean" ? "bool" : "number", node.value];
      else if (node.kind === "array") {
        yield ["array", node.items.length];
        for (const child of node.items) yield* visit.call(this, child, encoded);
      } else {
        yield ["object", node.entries.length];
        for (const [key, child] of node.entries) {
          yield* visit.call(this, key, false);
          yield* visit.call(this, child, encoded);
        }
      }
    };
    yield* visit.call(this, await row.source.at(row.range), row.encoded);
  }

  async digest(row: SourceRow): Promise<string> {
    const hash = createHash("sha256");
    for await (const token of this.tokens(row, async (string) => {
      hash.update(`s${string.node.chars - string.drop}:`);
      for await (const part of this.parts(string)) hash.update(Buffer.from(part, "utf16le"));
      return 0;
    }))
      hash.update(JSON.stringify(token) + "\n");
    return hash.digest("hex");
  }
}

function nonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function positive(value: unknown): value is number {
  return nonnegative(value) && value > 0;
}
