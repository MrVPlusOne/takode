// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JUMP_TARGET_PIN_MS, useJumpTargetPin } from "./message-feed-jump-target-pin.js";

// jsdom has no layout or ResizeObserver. The fixture models a 400px scroll
// container whose content above the jump target can grow (`aboveTarget`), and
// a ResizeObserver the test triggers the way the browser does after layout.
const observers = new Set<() => void>();
class TestResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    observers.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.callback);
  }
}
function layoutChanged() {
  for (const callback of [...observers]) callback();
}

let scrollTop = 0;
let aboveTarget = 1000;

function mountFeed() {
  document.body.innerHTML =
    '<div id="feed"><div id="root"><div data-turn-id="turn"><div data-message-id="target">Jumped-to message</div></div></div></div>';
  const container = document.querySelector<HTMLDivElement>("#feed")!;
  Object.defineProperties(container, {
    clientHeight: { value: 400 },
    offsetHeight: { value: 400 },
    scrollTop: { get: () => scrollTop, set: (value: number) => (scrollTop = value) },
  });
  vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 100, 400, 400));
  return container;
}

/** Give the current target element its position: content above it minus the scroll offset. */
function layoutTarget(container: HTMLDivElement) {
  const target = container.querySelector<HTMLElement>('[data-message-id="target"]')!;
  vi.spyOn(target, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 100 + aboveTarget - scrollTop, 400, 200),
  );
  return target;
}

function renderPin(container: HTMLDivElement, scopeKey = "session:q-1") {
  const refs = {
    containerRef: { current: container },
    contentRootRef: { current: container.querySelector<HTMLDivElement>("#root") },
    lastScrollTopRef: { current: 0 },
    programmaticScrollTargetRef: { current: null as number | null },
  };
  const hook = renderHook((props: { scopeKey: string }) => useJumpTargetPin({ ...refs, scopeKey: props.scopeKey }), {
    initialProps: { scopeKey },
  });
  return { ...hook, refs };
}

/** Land the jump the way the feed does: the target ends up 100px below the feed top. */
function jump(container: HTMLDivElement, pin: (target: HTMLElement) => void) {
  const target = layoutTarget(container);
  scrollTop = aboveTarget - 100;
  act(() => pin(target));
}

function targetOffset(container: HTMLDivElement) {
  return container.querySelector('[data-message-id="target"]')!.getBoundingClientRect().top - 100;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  scrollTop = 0;
  aboveTarget = 1000;
});

afterEach(() => {
  cleanup();
  observers.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the jumped-to message where it landed when content renders above it", () => {
  // The reported bug: quest cards loading after a jump pushed the target down.
  // Safari has no CSS scroll anchoring, so nothing else moves the view back.
  const container = mountFeed();
  const { result, refs } = renderPin(container);
  jump(container, result.current.pinJumpTarget);
  expect(targetOffset(container)).toBe(100);

  aboveTarget += 135;
  layoutChanged();

  expect(targetOffset(container)).toBe(100);
  expect(scrollTop).toBe(1035);
  // The correction is marked programmatic so the feed's scroll handler does not read it as user scrolling.
  expect(refs.programmaticScrollTargetRef.current).toBe(1035);
  expect(refs.lastScrollTopRef.current).toBe(1035);

  // Content above can also shrink; the target must not jump up either.
  aboveTarget -= 300;
  layoutChanged();
  expect(targetOffset(container)).toBe(100);
});

it("finds the target again after a window replacement remounts it", () => {
  const container = mountFeed();
  const { result } = renderPin(container);
  jump(container, result.current.pinJumpTarget);

  container.querySelector("#root")!.innerHTML =
    '<div data-turn-id="turn"><div data-message-id="target">Jumped-to message</div></div>';
  aboveTarget += 500;
  layoutTarget(container);
  layoutChanged();

  expect(targetOffset(container)).toBe(100);
});

it("lets go once the user touches the feed", () => {
  // After the user takes over, content changes must not move the view
  // (for example expanding a collapsed turn above the target by tapping it).
  const container = mountFeed();
  const { result } = renderPin(container);
  jump(container, result.current.pinJumpTarget);

  container.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  aboveTarget += 135;
  layoutChanged();

  expect(targetOffset(container)).toBe(235);
});

it("lets go on deliberate navigation, a thread switch and after the settle time", () => {
  const container = mountFeed();
  const { result, rerender } = renderPin(container);
  const grows = () => {
    const before = scrollTop;
    aboveTarget += 100;
    layoutChanged();
    return scrollTop !== before;
  };

  // Deliberate navigation (wheel, Go to bottom, another jump) calls release.
  jump(container, result.current.pinJumpTarget);
  act(() => result.current.releaseJumpTarget());
  expect(grows()).toBe(false);

  // The same message can show in another thread of the session; leaving the thread ends the pin.
  jump(container, result.current.pinJumpTarget);
  rerender({ scopeKey: "session:main" });
  expect(grows()).toBe(false);

  vi.useFakeTimers();
  jump(container, result.current.pinJumpTarget);
  expect(grows()).toBe(true);
  act(() => vi.advanceTimersByTime(JUMP_TARGET_PIN_MS));
  expect(grows()).toBe(false);
});
