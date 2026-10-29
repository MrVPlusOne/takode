// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFeedPinnedTop } from "./feed-pinned-top.js";
import { TopicFeedContext } from "./topic-feed.js";

/**
 * A topic conversation's pinned quest strip covered the Next chip at the feed's top right. The
 * feed's overlay now carries the height of what is pinned at its top: the strip
 * (`--feed-pinned-top`, topic conversations only) and a pinned report collapse bar
 * (`--feed-pinned-bar`), and the top controls start below them.
 */

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) };
}

function stubRect(element: HTMLElement | null, value: DOMRect) {
  if (element) element.getBoundingClientRect = () => value;
}

function Feed({ strip, report }: { strip: boolean; report?: { cardTop: number; barTop: number } }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pinned = useFeedPinnedTop(containerRef, rootRef, "layout");
  return (
    <div data-testid="overlay" style={pinned.style} data-below-strip={String(pinned.belowPinnedStrip)}>
      <div ref={containerRef} data-testid="container">
        <div ref={rootRef}>
          {strip && <div data-testid="topic-feed-quest-start" data-feed-quest-strip="true" />}
          {report && (
            <div data-testid="card" ref={(el) => stubRect(el, rect(report.cardTop, 2000))}>
              <div data-feed-pinned-bar="" ref={(el) => stubRect(el, rect(report.barTop, 26))} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderFeed(topic: boolean, report?: { cardTop: number; barTop: number }) {
  // jsdom does no layout: every element is 44px tall here (a strip's wrapper; the bar reads it too).
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(44);
  return render(
    <TopicFeedContext.Provider
      value={topic ? { questIds: ["q-3"], topicKey: "topic:aaaaaaaa", topicName: "Relay", openQuest: vi.fn() } : null}
    >
      <Feed strip={topic} report={report} />
    </TopicFeedContext.Provider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useFeedPinnedTop", () => {
  it("reserves the strip's height in a topic conversation", () => {
    renderFeed(true);
    const overlay = screen.getByTestId("overlay");
    expect(overlay.style.getPropertyValue("--feed-pinned-top")).toBe("44px");
    expect(overlay.style.getPropertyValue("--feed-pinned-bar")).toBe("0px");
    expect(overlay.dataset.belowStrip).toBe("true");
  });

  it("reserves nothing outside topic conversations while no bar is pinned", () => {
    // The report's bar sits at the top of its report (it scrolls with it), so it is not pinned.
    renderFeed(false, { cardTop: 200, barTop: 200 });
    const overlay = screen.getByTestId("overlay");
    expect(overlay.style.getPropertyValue("--feed-pinned-top")).toBe("");
    expect(overlay.style.getPropertyValue("--feed-pinned-bar")).toBe("0px");
    expect(overlay.dataset.belowStrip).toBe("false");
  });

  it("reserves a report's collapse bar while it is pinned at the top, under the strip", () => {
    // The container's top is 0 and the strip 44px tall, so a pinned bar sits at 44 while its
    // report has scrolled above it.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(0, 44));
    renderFeed(true, { cardTop: -900, barTop: 44 });
    act(() => {
      screen.getByTestId("container").dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByTestId("overlay").style.getPropertyValue("--feed-pinned-bar")).toBe("44px");
  });
});
