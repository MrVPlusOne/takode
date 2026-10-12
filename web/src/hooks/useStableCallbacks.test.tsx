// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useStableCallbacks } from "./useStableCallbacks.js";

// Sidebar rows are memoized; their handlers must keep one identity across list re-renders
// (or every row re-renders on every session update) while still running the newest logic.
describe("useStableCallbacks", () => {
  it("keeps handler identities across renders and calls the latest handler", () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(
      ({ label }) => useStableCallbacks({ onSelect: (id: string) => calls.push(`${label}:${id}`) }),
      {
        initialProps: { label: "first" },
      },
    );
    const firstOnSelect = result.current.onSelect;

    rerender({ label: "second" });

    expect(result.current.onSelect).toBe(firstOnSelect);
    result.current.onSelect("s-1");
    expect(calls).toEqual(["second:s-1"]);
  });
});
