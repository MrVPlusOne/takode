// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useStore } from "../store.js";
import {
  useExactViewportRestore,
  useIdempotentState,
  useUserViewportNavigationIntent,
} from "./message-feed-viewport-state.js";

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

describe("useUserViewportNavigationIntent", () => {
  it("retires route ownership and clears every pending message target", () => {
    useStore.getState().reset();
    useStore.setState({
      scrollToMessageId: new Map([["s1", "search-target"]]),
      pendingScrollToMessageId: new Map([["s1", "search-target"]]),
      pendingScrollToMessageIndex: new Map([["s1", 42]]),
      expandAllInTurn: new Map([["s1", "search-target"]]),
    });
    window.location.hash = "#/session/s1/msg/search-target?thread=main";
    const cancelPendingRestore = vi.fn();
    const { result } = renderHook(() => useUserViewportNavigationIntent(cancelPendingRestore, "s1", "main"));

    act(() => result.current());

    expect(cancelPendingRestore).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/session/s1?thread=main");
    expect(useStore.getState().scrollToMessageId.has("s1")).toBe(false);
    expect(useStore.getState().pendingScrollToMessageId.has("s1")).toBe(false);
    expect(useStore.getState().pendingScrollToMessageIndex.has("s1")).toBe(false);
    expect(useStore.getState().expandAllInTurn.has("s1")).toBe(false);
  });
});
