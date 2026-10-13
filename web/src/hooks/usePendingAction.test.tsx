// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePendingAction } from "./usePendingAction.js";

// Validates the shared pending state behind buttons that wait on the server:
// it is busy while the action runs, refuses a second run, and reports failures.
describe("usePendingAction", () => {
  it("is pending until the action settles and refuses a second run meanwhile", async () => {
    let finish!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => usePendingAction("Save failed."));

    let first!: Promise<boolean>;
    act(() => {
      first = result.current.run(action);
    });
    expect(result.current.pending).toBe(true);
    let second!: boolean;
    await act(async () => {
      second = await result.current.run(action);
    });
    expect(second).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(await first).toBe(true);
    expect(result.current.pending).toBe(false);
  });

  it("turns a failure into an error message and clears it on the next run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => usePendingAction("Save failed."));
    let ok!: boolean;
    await act(async () => {
      ok = await result.current.run(() => Promise.reject(new Error("Offline")));
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("Save failed. Offline");
    expect(result.current.pending).toBe(false);

    await act(async () => {
      await result.current.run(() => Promise.resolve());
    });
    expect(result.current.error).toBeNull();
  });
});
