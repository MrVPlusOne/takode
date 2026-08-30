import { describe, expect, it } from "vitest";
import {
  arraysEqual,
  reconcileArray,
  reconcileKeyedArray,
  reconcileRecord,
  reconcileValue,
  reuseIfEqual,
} from "./stable-reconciliation.js";

interface Item {
  id: string;
  value: number;
}

const itemEqual = (left: Item, right: Item) => left.id === right.id && left.value === right.value;

describe("stable reconciliation primitives", () => {
  it("reuses equal direct values and arrays", () => {
    const previous = { value: 1 };
    expect(reuseIfEqual(previous, { value: 1 }, (left, right) => left.value === right.value)).toBe(previous);
    expect(reconcileValue(undefined, previous, (left, right) => left.value === right.value)).toBe(previous);

    const items: Item[] = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    expect(
      arraysEqual(
        items,
        items.map((item) => ({ ...item })),
        itemEqual,
      ),
    ).toBe(true);
    expect(
      reconcileArray(
        items,
        items.map((item) => ({ ...item })),
        itemEqual,
      ),
    ).toBe(items);
  });

  it("reuses keyed entries across ordering changes", () => {
    const first = { id: "a", value: 1 };
    const second = { id: "b", value: 2 };
    const previous = [first, second];
    const reconciled = reconcileKeyedArray(
      previous,
      [
        { id: "b", value: 2 },
        { id: "a", value: 1 },
      ],
      (item) => item.id,
      itemEqual,
    );

    expect(reconciled).not.toBe(previous);
    expect(reconciled[0]).toBe(second);
    expect(reconciled[1]).toBe(first);
  });

  it("preserves equal record values and the whole record when unchanged", () => {
    const first = { id: "a", value: 1 };
    const second = { id: "b", value: 2 };
    const previous = { a: first, b: second };
    const unchanged = reconcileRecord(previous, { a: { ...first }, b: { ...second } }, itemEqual);
    expect(unchanged).toBe(previous);

    const changed = reconcileRecord(previous, { a: { ...first }, b: { id: "b", value: 3 } }, itemEqual);
    expect(changed).not.toBe(previous);
    expect(changed.a).toBe(first);
    expect(changed.b).toEqual({ id: "b", value: 3 });
  });
});
