// @vitest-environment jsdom

import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageFeedManualScrollHandlers } from "./message-feed-manual-scroll.js";

function makeContainer() {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 400 },
    clientWidth: { configurable: true, value: 580 },
    offsetWidth: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 2000 },
    scrollTop: { configurable: true, writable: true, value: 500 },
  });
  container.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 600, height: 400 });
  document.body.appendChild(container);
  return container;
}

describe("useMessageFeedManualScrollHandlers", () => {
  it("marks wheel intent while preserving automatic boundary loading", () => {
    const container = makeContainer();
    const onUserNavigationIntent = vi.fn();
    const triggerSectionLoadNearBoundary = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMessageFeedManualScrollHandlers({
        boundaryTriggerPx: 96,
        containerRef: { current: container },
        getRealContentBottom: () => 2000,
        onUserNavigationIntent,
        triggerSectionLoadNearBoundary,
      }),
    );

    act(() => result.current.handleWheel({ deltaY: 120 } as never));
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(1);
    expect(triggerSectionLoadNearBoundary).not.toHaveBeenCalled();

    container.scrollTop = 1590;
    act(() => result.current.handleWheel({ deltaY: 120 } as never));
    expect(triggerSectionLoadNearBoundary).toHaveBeenCalledWith("newer");

    unmount();
    container.remove();
  });

  it("consumes scoped keyboard intent only after the feed actually scrolls", () => {
    const container = makeContainer();
    const onUserNavigationIntent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMessageFeedManualScrollHandlers({
        boundaryTriggerPx: 96,
        containerRef: { current: container },
        getRealContentBottom: () => 2000,
        onUserNavigationIntent,
        triggerSectionLoadNearBoundary: vi.fn(),
      }),
    );

    fireEvent.keyDown(document.body, { key: "PageDown" });
    expect(onUserNavigationIntent).not.toHaveBeenCalled();
    act(() => result.current.handleKeyboardScroll());
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(1);

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "PageDown" });
    act(() => result.current.handleKeyboardScroll());
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(1);

    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    fireEvent.keyDown(overlay, { key: "PageDown" });
    act(() => result.current.handleKeyboardScroll());
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(1);

    const button = document.createElement("button");
    container.appendChild(button);
    fireEvent.keyDown(button, { key: "PageDown" });
    act(() => result.current.handleKeyboardScroll());
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(button, { key: " " });
    act(() => result.current.handleKeyboardScroll());
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(2);

    container.scrollTop = 1600;
    fireEvent.keyDown(document.body, { key: "PageDown" });
    act(() => result.current.handleKeyboardScroll());
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(2);

    input.remove();
    overlay.remove();
    unmount();
    container.remove();
  });

  it("recognizes scrollbar-gutter pointer intent but ignores content clicks", () => {
    const container = makeContainer();
    const onUserNavigationIntent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMessageFeedManualScrollHandlers({
        boundaryTriggerPx: 96,
        containerRef: { current: container },
        getRealContentBottom: () => 2000,
        onUserNavigationIntent,
        triggerSectionLoadNearBoundary: vi.fn(),
      }),
    );

    act(() =>
      result.current.handlePointerDown({
        button: 0,
        clientX: 300,
        currentTarget: container,
        target: container,
      } as never),
    );
    expect(onUserNavigationIntent).not.toHaveBeenCalled();

    act(() =>
      result.current.handlePointerDown({
        button: 0,
        clientX: 595,
        currentTarget: container,
        target: container,
      } as never),
    );
    expect(onUserNavigationIntent).toHaveBeenCalledTimes(1);

    unmount();
    container.remove();
  });
});
