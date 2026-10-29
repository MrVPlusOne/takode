// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useLatestLandingAboveStatus } from "./message-feed-latest-landing.js";

/**
 * A feed opened at its latest messages lands with the last message at the bottom of the view and
 * the thread status rows (Thread Waiting, the worker's live preview) just below it, instead of
 * scrolling past the message to the worker's activity.
 */

const VIEW_HEIGHT = 400;
const END_SPACE = 60;

function rect(top: number, height: number): DOMRect {
  return DOMRect.fromRect({ y: top, width: 600, height });
}

/**
 * A feed whose content is laid out at fixed offsets: messages, then optional status rows.
 * Element rects follow the container's scrollTop, as in a browser.
 */
function Feed({
  rows,
  contentReady = true,
  pin = vi.fn(),
  onState,
}: {
  rows: Array<{ id: string; top: number; height: number; status?: boolean }>;
  contentReady?: boolean;
  pin?: (target: HTMLElement) => void;
  onState: (state: { following: boolean; scrollTop: () => number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const landingRef = useRef(false);
  const state = useRef({ following: true });
  const contentBottom = Math.max(...rows.map((row) => row.top + row.height));
  const request = useLatestLandingAboveStatus({
    landingRef,
    containerRef,
    contentReady,
    layoutKey: rows.map((row) => row.id).join(","),
    getRealContentBottom: () => contentBottom,
    setScrollTop: (top) => {
      containerRef.current!.scrollTop = top;
    },
    setAutoFollowEnabled: (enabled) => {
      state.current.following = enabled;
    },
    isNearBottomRef: { current: true },
    setShowScrollButton: () => {},
    onLanded: () => {},
    pin,
  });
  useEffect(() => {
    const container = containerRef.current!;
    let scrollTop = Math.max(0, contentBottom - VIEW_HEIGHT);
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: VIEW_HEIGHT });
    // 60px of trailing space below the content keeps it clear of the floating controls.
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: contentBottom + END_SPACE });
    Object.defineProperty(container, "offsetHeight", { configurable: true, value: VIEW_HEIGHT });
    container.getBoundingClientRect = () => rect(0, VIEW_HEIGHT);
    for (const element of container.querySelectorAll<HTMLElement>("[data-row]")) {
      const row = rows.find((candidate) => candidate.id === element.dataset.row)!;
      element.getBoundingClientRect = () => rect(row.top - scrollTop, row.height);
    }
    onState({ following: state.current.following, scrollTop: () => scrollTop });
    request();
  }, []);
  return (
    <div ref={containerRef}>
      {rows.map((row) =>
        row.status ? (
          <div key={row.id} data-row={row.id} data-feed-thread-status-footer="true" />
        ) : (
          <div key={row.id} data-row={row.id} data-message-id={row.id} />
        ),
      )}
    </div>
  );
}

function open(rows: Parameters<typeof Feed>[0]["rows"], options: { contentReady?: boolean } = {}) {
  let scrollTop = () => 0;
  const pin = vi.fn();
  const view = render(
    <Feed
      rows={rows}
      pin={pin}
      contentReady={options.contentReady}
      onState={(state) => {
        scrollTop = state.scrollTop;
      }}
    />,
  );
  return { view, pin, scrollTop: () => scrollTop() };
}

describe("useLatestLandingAboveStatus", () => {
  it("lands with the worker's activity just below the view, and holds the last message there", () => {
    const { pin, scrollTop } = open([
      { id: "m1", top: 0, height: 500 },
      { id: "m2", top: 520, height: 300 },
      { id: "status", top: 840, height: 200, status: true },
    ]);
    // Real bottom would be 1040 - 400 = 640. The status rows start at 840 and go where the content's
    // end sits at the physical bottom, 60px above the view's bottom: 840 + 60 - 400 = 500.
    expect(scrollTop()).toBe(500);
    expect(pin).toHaveBeenCalledWith(expect.objectContaining({ dataset: expect.objectContaining({ row: "m2" }) }));
  });

  it("stays at the real bottom without status rows under the last message", () => {
    const { pin, scrollTop } = open([
      { id: "m1", top: 0, height: 500 },
      { id: "m2", top: 520, height: 300 },
    ]);
    expect(scrollTop()).toBe(420);
    expect(pin).not.toHaveBeenCalled();
  });

  it("does not land on status rows that a later message follows", () => {
    const { scrollTop } = open([
      { id: "m1", top: 0, height: 500 },
      { id: "status", top: 520, height: 100, status: true },
      { id: "m2", top: 640, height: 300 },
    ]);
    expect(scrollTop()).toBe(540);
  });

  it("waits until the newest messages are shown", () => {
    const rows = [
      { id: "m1", top: 0, height: 500 },
      { id: "m2", top: 520, height: 300 },
      { id: "status", top: 840, height: 200, status: true },
    ];
    const { view, scrollTop } = open(rows, { contentReady: false });
    expect(scrollTop()).toBe(640);
    view.rerender(<Feed rows={rows} contentReady onState={() => {}} />);
    expect(scrollTop()).toBe(500);
  });
});
