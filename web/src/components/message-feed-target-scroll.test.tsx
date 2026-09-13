// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { scrollMessageFeedTargetIntoView } from "./message-feed-target-scroll.js";
import { useMessageFeedStatusLayout } from "./use-message-feed-status-layout.js";

const annotation = {
  id: "comment",
  sourceMessageId: "source",
  selectedText: "Selected passage",
  comment: "Keep visible",
};
beforeEach(() => useStore.setState({ annotationEditor: null }));
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function fixture(contentHeight = 1000, passageOffset = 800) {
  document.body.innerHTML =
    '<div id="feed"><div data-message-id="source"><p data-chat-selection-scope="true">Selected passage</p></div><div data-feed-end-slack></div></div>';
  const container = document.querySelector<HTMLDivElement>("#feed")!;
  const target = container.firstElementChild as HTMLElement;
  let top = 0;
  let space = 0;
  Object.defineProperties(container, {
    clientHeight: { value: 400 },
    offsetHeight: { value: 400 },
    scrollHeight: { get: () => Math.max(400, contentHeight + space) },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, Math.max(0, contentHeight + space - 400)));
      },
    },
  });
  vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 90, 800, 360));
  vi.spyOn(target, "getBoundingClientRect").mockImplementation(() => new DOMRect(20, 126 - top * 0.9, 700, 720));
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, writable: true, value: () => [] });
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
    () => [new DOMRect(20, 90 + (passageOffset - top) * 0.9, 150, 18)] as unknown as DOMRectList,
  );
  vi.spyOn(container.lastElementChild!, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 90 + (contentHeight + space - top) * 0.9, 100, 0),
  );
  const reserve = vi.fn((amount: number) => {
    space += amount;
  });
  const save = vi.fn();
  const scroll = () =>
    scrollMessageFeedTargetIntoView({
      container,
      target,
      targetMessageId: "source",
      targetTurnId: "turn",
      sessionId: "session",
      threadKey: "main",
      viewportKey: "session:main",
      isLeaderSession: false,
      lastSeenContentBottom: 980,
      getRealContentBottom: () => 980,
      markProgrammaticScroll: vi.fn(),
      setShowScrollButton: vi.fn(),
      setAutoFollowEnabled: vi.fn(),
      setFeedScrollPosition: save,
      reserveTargetScrollSpace: reserve,
      refs: { lastScrollTop: { current: 0 }, isNearBottom: { current: true } },
    });
  return { container, target, reserve, save, scroll };
}

it("places the selected passage near the feed top with zoom and insufficient trailing content, saving that same position", () => {
  // A source can be mounted correctly while its later quotation still cannot scroll upward at the physical bottom.
  useStore
    .getState()
    .setAnnotationEditor({ sessionId: "session", threadKey: "main", annotation, navigateToSource: true });
  const { container, reserve, save, scroll } = fixture();
  const position = scroll();
  expect(reserve).toHaveBeenCalledWith(176, 400);
  expect(container.scrollTop).toBe(776);
  expect(810 - container.scrollTop * 0.9 - 90).toBeCloseTo(24 * 0.9);
  expect(position.anchorMessageId).toBe("source");
  expect(position.anchorOffsetTop).toBeCloseTo(-662.4);
  expect(save).toHaveBeenCalledWith("session:main", position);
});

it("keeps ordinary message jumps independent from an editor on another thread or an unverifiable quote", () => {
  useStore
    .getState()
    .setAnnotationEditor({ sessionId: "session", threadKey: "other", annotation, navigateToSource: true });
  const { reserve, scroll, target } = fixture();
  expect(scroll().scrollTop).toBe(40);
  expect(reserve).not.toHaveBeenCalled();
  expect(target.classList.contains("message-scroll-highlight")).toBe(true);
  useStore.getState().setAnnotationEditor({
    sessionId: "session",
    threadKey: "main",
    annotation: { ...annotation, selectedText: "Missing" },
    navigateToSource: true,
  });
  scroll();
  expect(reserve).not.toHaveBeenCalled();
});

it("bounds passage scroll space to a viewport and keeps it through editor close without leaking into another thread", () => {
  // Removing scroll capacity on editor close would immediately clamp the same passage back down the screen.
  const { result, rerender } = renderHook(({ thread }) => useMessageFeedStatusLayout("session", thread), {
    initialProps: { thread: "main" },
  });
  const baseline = result.current.feedEndScrollSlack;
  act(() => result.current.reserveTargetScrollSpace(176, 400));
  expect(result.current.feedEndScrollSlack).toBe(baseline + 176);
  act(() => useStore.getState().setAnnotationEditor(null));
  expect(result.current.feedEndScrollSlack).toBe(baseline + 176);
  act(() => result.current.reserveTargetScrollSpace(500, 400));
  expect(result.current.feedEndScrollSlack).toBe(baseline + 400);
  rerender({ thread: "other" });
  expect(result.current.feedEndScrollSlack).toBe(baseline);
});

it("reserves unused viewport space when the answer initially has no scrollbar", () => {
  // Browser scrollHeight rounds a short answer up to the viewport; include that hidden deficit.
  useStore
    .getState()
    .setAnnotationEditor({ sessionId: "session", threadKey: "main", annotation, navigateToSource: true });
  const { container, reserve, scroll } = fixture(300, 200);
  expect(container.scrollHeight).toBe(container.clientHeight);
  scroll();
  expect(reserve).toHaveBeenCalledWith(276, 400);
  expect(container.scrollTop).toBe(176);
});
