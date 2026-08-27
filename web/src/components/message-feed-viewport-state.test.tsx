// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useExactViewportRestore, useIdempotentState } from "./message-feed-viewport-state.js";

describe("useIdempotentState", () => {
  it("does not rerender for repeated same-value boolean writes", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useIdempotentState(false);
    });

    act(() => result.current[1](false));
    expect(renderCount).toBe(1);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(renderCount).toBe(2);

    act(() => result.current[1](true));
    expect(renderCount).toBe(2);
  });

  it("supports functional updates while preserving same-value no-ops", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useIdempotentState(false);
    });

    act(() => result.current[1]((current) => current));
    expect(renderCount).toBe(1);

    act(() => result.current[1]((current) => !current));
    expect(result.current[0]).toBe(true);
    expect(renderCount).toBe(2);
  });
});

describe("useExactViewportRestore", () => {
  it("retires a cancelled restore key so late window hydration cannot recreate it", () => {
    const container = document.createElement("div") as HTMLDivElement;
    const containerRef = { current: container };
    const restoredViewportRef: { current: { key: string; container: HTMLDivElement | null } | null } = {
      current: null,
    };
    const { result } = renderHook(() => useExactViewportRestore(restoredViewportRef, containerRef));
    const pending = {
      restoreKey: "s1:main:message-117",
      position: {
        scrollTop: 11_700,
        scrollHeight: 14_000,
        isAtBottom: false,
        anchorMessageId: "message-117",
      },
    };

    act(() => {
      result.current[0].current = pending;
      result.current[1]();
    });

    expect(result.current[0].current).toBeNull();
    expect(restoredViewportRef.current).toEqual({ key: pending.restoreKey, container });
  });
});
