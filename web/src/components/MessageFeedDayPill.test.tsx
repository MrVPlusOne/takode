// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef } from "react";
import { MessageFeedDayPill, findFeedDayAtTop } from "./MessageFeedDayPill.js";

/**
 * Builds a feed of dated markers (message time labels and day dividers) with fixed vertical
 * positions, since jsdom has no layout. Each marker's bottom edge is what the search compares.
 */
function feed(markers: { time: number; bottom: number; divider?: boolean }[]): HTMLElement {
  const root = document.createElement("div");
  for (const marker of markers) {
    const el = document.createElement("time");
    el.dataset.feedTime = String(marker.time);
    if (marker.divider) el.dataset.feedDayDivider = "true";
    el.getBoundingClientRect = () => ({ bottom: marker.bottom }) as DOMRect;
    root.appendChild(el);
  }
  return root;
}

const MON_DIVIDER = { time: 100, bottom: 0, divider: true };
const MON_MSG = { time: 110, bottom: 200 };
const TUE_DIVIDER = { time: 200, bottom: 400, divider: true };
const TUE_MSG = { time: 210, bottom: 600 };

describe("findFeedDayAtTop", () => {
  it("reads the day of the message whose label is the first one below the top", () => {
    // Monday's divider scrolled away; Monday's message is at the top of the view.
    expect(findFeedDayAtTop(feed([MON_DIVIDER, MON_MSG, TUE_DIVIDER, TUE_MSG]), 150)).toBe(110);
  });

  it("gives content just above a day divider the previous day", () => {
    // Between Monday's last label and Tuesday's divider, the top is still Monday's content.
    expect(findFeedDayAtTop(feed([MON_DIVIDER, MON_MSG, TUE_DIVIDER, TUE_MSG]), 300)).toBe(110);
  });

  it("reads the newest day once every marker is above the top", () => {
    // A long last message: its own label is below, but everything earlier scrolled away.
    expect(findFeedDayAtTop(feed([MON_DIVIDER, MON_MSG, TUE_DIVIDER, TUE_MSG]), 700)).toBe(210);
  });

  it("shows no day when the oldest loaded divider is still in view", () => {
    // The divider itself names the day, so a pill would repeat it.
    expect(findFeedDayAtTop(feed([{ ...MON_DIVIDER, bottom: 50 }, MON_MSG]), 10)).toBeNull();
  });

  it("shows no day for a feed without dated content", () => {
    expect(findFeedDayAtTop(feed([]), 10)).toBeNull();
  });
});

describe("MessageFeedDayPill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A scrolled feed whose top shows a message from two days ago (jsdom has no layout, so it is faked). */
  function Feed() {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRootRef = useRef<HTMLDivElement>(null);
    const twoDaysAgo = new Date(2026, 9, 25, 10, 0).getTime();
    return (
      <>
        <div
          ref={(el) => {
            containerRef.current = el;
            if (!el) return;
            Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 });
            el.scrollTop = 300;
          }}
          data-testid="feed"
        >
          <div ref={contentRootRef}>
            <time
              data-feed-time={twoDaysAgo}
              ref={(el) => {
                if (el) el.getBoundingClientRect = () => ({ top: 10, bottom: 30 }) as DOMRect;
              }}
            />
          </div>
        </div>
        <MessageFeedDayPill containerRef={containerRef} contentRootRef={contentRootRef} layoutSignature="x" />
      </>
    );
  }

  it("shows the day only while the feed scrolls, then fades out", () => {
    // A feed at rest is never covered by the pill: it appears on scroll (including jumps) and
    // goes away shortly after scrolling stops.
    render(<Feed />);
    const pill = screen.getByTestId("message-feed-day-pill");
    expect(pill.textContent).toContain("2 days ago");
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill.className).toContain("opacity-0");

    act(() => {
      screen.getByTestId("feed").dispatchEvent(new Event("scroll"));
    });
    expect(pill.className).toContain("opacity-100");
    expect(pill).not.toHaveAttribute("aria-hidden");

    // Further scrolling keeps it up; it fades only once scrolling has stopped for a while.
    act(() => {
      vi.advanceTimersByTime(1000);
      screen.getByTestId("feed").dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(1000);
    });
    expect(pill.className).toContain("opacity-100");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(pill.className).toContain("opacity-0");
  });
});
