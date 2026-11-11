import { describe, expect, it } from "vitest";
import { ObjectMemo } from "./object-memo.js";

describe("ObjectMemo", () => {
  it("keeps one value per object, invisible to serialization and copies", () => {
    // Per-message caches live on the messages themselves (WeakMaps made every collection dearer),
    // so the cached value must never leak into what is saved, sent or copied.
    const memo = new ObjectMemo<{ size: number }>("size");
    const message = { type: "assistant", text: "hello" };
    expect(memo.get(message)).toBeUndefined();
    memo.set(message, { size: 5 });
    expect(memo.get(message)).toEqual({ size: 5 });
    memo.set(message, { size: 6 });
    expect(memo.get(message)).toEqual({ size: 6 });

    expect(JSON.stringify(message)).toBe('{"type":"assistant","text":"hello"}');
    expect(Object.keys(message)).toEqual(["type", "text"]);
    expect(memo.get({ ...message })).toBeUndefined();
    expect(memo.get(structuredClone(message))).toBeUndefined();
    expect({ ...message }).toStrictEqual({ type: "assistant", text: "hello" });

    // Two memos never share a slot.
    const other = new ObjectMemo<number>("size");
    expect(other.get(message)).toBeUndefined();
  });

  it("skips objects that can't take new properties", () => {
    const memo = new ObjectMemo<number>("count");
    const frozen = Object.freeze({ a: 1 });
    memo.set(frozen, 3);
    expect(memo.get(frozen)).toBeUndefined();
  });
});
