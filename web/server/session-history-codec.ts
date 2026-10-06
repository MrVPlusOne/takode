import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const HISTORY_STRING_CHARS = 16 * 1024;
export const HISTORY_THRESHOLD_BYTES = 1024 * 1024;

/** Capture JSON container ownership without making another copy of immutable strings. */
export function captureJson<T>(input: T): T {
  const ancestors = new Set<object>();
  function visit(value: unknown, key: string): JsonValue | undefined {
    if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") {
      value = value.toJSON(key);
    }
    if (value instanceof Number || value instanceof String || value instanceof Boolean) value = value.valueOf();
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") throw new TypeError("Cannot serialize BigInt session data");
    if (typeof value !== "object") return undefined;
    if (ancestors.has(value)) throw new TypeError("Circular session data");
    ancestors.add(value);
    let result: JsonValue;
    if (Array.isArray(value)) {
      result = Array.from(value, (item, i) => visit(item, String(i)) ?? null);
    } else {
      const object: Record<string, JsonValue> = {};
      for (const key of Object.keys(value)) {
        const child = visit((value as Record<string, unknown>)[key], key);
        if (child !== undefined)
          Object.defineProperty(object, key, { value: child, enumerable: true, writable: true, configurable: true });
      }
      result = object;
    }
    ancestors.delete(value);
    return result;
  }
  return visit(input, "") as T;
}

/** Conservative early-exit size estimate; never stringify history to select its format. */
export function isLargeHistory(values: unknown[]): boolean {
  let bytes = 0;
  function visit(value: unknown): boolean {
    if (typeof value === "string") bytes += value.length * 2 + 2;
    else if (Array.isArray(value)) {
      bytes += 2 + value.length;
      for (const item of value) if (visit(item)) return true;
    } else if (value && typeof value === "object") {
      bytes += 2;
      for (const [key, item] of Object.entries(value)) {
        bytes += key.length * 2 + 3;
        if (visit(item)) return true;
      }
    } else bytes += 8;
    return bytes >= HISTORY_THRESHOLD_BYTES;
  }
  return visit(values);
}

/** Bounded typed tokens are outside the payload, including for object property names. */
export function* valueTokens(value: JsonValue, stringId: (value: string) => number): Generator<unknown[]> {
  if (value === null) yield ["null"];
  else if (typeof value === "string") yield ["ref", stringId(value)];
  else if (typeof value === "boolean") yield ["bool", value];
  else if (typeof value === "number") yield ["number", value];
  else if (Array.isArray(value)) {
    yield ["array", value.length];
    for (const item of value) yield* valueTokens(item, stringId);
  } else {
    const keys = Object.keys(value);
    yield ["object", keys.length];
    for (const key of keys) {
      yield ["ref", stringId(key)];
      yield* valueTokens(value[key], stringId);
    }
  }
}

/** Content identity uses bounded UTF-16 pieces, including unpaired surrogates. */
export function valueDigest(value: JsonValue): string {
  const hash = createHash("sha256");
  function string(value: string): number {
    hash.update(`s${value.length}:`);
    for (let i = 0; i < value.length; i += HISTORY_STRING_CHARS) {
      hash.update(Buffer.from(value.slice(i, i + HISTORY_STRING_CHARS), "utf16le"));
    }
    return 0;
  }
  for (const token of valueTokens(value, string)) hash.update(JSON.stringify(token) + "\n");
  return hash.digest("hex");
}

export function* stringFrames(id: number, value: string): Generator<unknown[]> {
  yield ["string", id, value.length];
  for (let i = 0; i < value.length; i += HISTORY_STRING_CHARS) {
    yield ["part", value.slice(i, i + HISTORY_STRING_CHARS)];
  }
  yield ["endString"];
}
