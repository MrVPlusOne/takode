// @vitest-environment jsdom
import { findFeedDayAtTop } from "./MessageFeedDayPill.js";

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
