import { describe, expect, it } from "vitest";
import {
  isBoundedNullableString,
  isBoundedString,
  isNonNegativeInteger,
  isNonNegativeNullableNumber,
  isNonNegativeNumber,
  isPositiveInteger,
  isPositiveNullableInteger,
  jsonUtf8ByteLength,
  utf8ByteLength,
} from "./synced-projection-codec.js";

describe("synchronized projection codec primitives", () => {
  it("validates bounded strings without changing UTF-16 length semantics", () => {
    expect(isBoundedString("abc", 3)).toBe(true);
    expect(isBoundedString("abc", 2)).toBe(false);
    expect(isBoundedString("🙂", 2)).toBe(true);
    expect(isBoundedString("🙂", 1)).toBe(false);
    expect(isBoundedString(1, 3)).toBe(false);
    expect(isBoundedNullableString(null, 3)).toBe(true);
    expect(isBoundedNullableString("abcd", 3)).toBe(false);
  });

  it("keeps integer and finite-number boundaries explicit", () => {
    expect(isNonNegativeNumber(0)).toBe(true);
    expect(isNonNegativeNumber(-1)).toBe(false);
    expect(isNonNegativeNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveNullableInteger(null)).toBe(true);
    expect(isPositiveNullableInteger(2)).toBe(true);
    expect(isNonNegativeNullableNumber(null)).toBe(true);
    expect(isNonNegativeNullableNumber(Number.NaN)).toBe(false);
  });

  it("counts UTF-8 payload bytes consistently in browser-safe code", () => {
    const samples = ["ascii", "é", "🙂", "\ud800", JSON.stringify({ value: "🙂" })];
    for (const sample of samples) {
      expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).byteLength);
    }
    expect(jsonUtf8ByteLength({ value: "🙂" })).toBe(
      new TextEncoder().encode(JSON.stringify({ value: "🙂" })).byteLength,
    );
    expect(jsonUtf8ByteLength(undefined)).toBeNull();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(jsonUtf8ByteLength(cyclic)).toBeNull();
    expect(jsonUtf8ByteLength(1n)).toBeNull();
  });
});
