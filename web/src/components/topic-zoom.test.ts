// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { landZoom, prepareZoom, takeZoomPlacement } from "./topic-zoom.js";

/**
 * Zooming between a quest and its topic keeps the reader's place: the message on top of the view
 * before lands at the same height after, through an ordinary jump that reads its placement
 * here; and the column plays a short scale (never an opacity start, which can leave feed rows
 * blank on phones).
 */

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) };
}

/** A visible feed of `threadKey` whose children sit at the given tops (container top at 100). */
function mountFeed(threadKey: string, rows: Array<{ id?: string; strip?: string; top: number }>): HTMLElement {
  const column = document.createElement("div");
  const feed = document.createElement("div");
  feed.dataset.testid = "message-feed-scroll-container";
  feed.dataset.feedSessionId = "s1";
  feed.dataset.feedThreadKey = threadKey;
  Object.defineProperty(feed, "offsetParent", { value: document.body });
  Object.defineProperty(feed, "offsetHeight", { value: 800 });
  feed.getBoundingClientRect = () => rect(100, 800);
  column.getBoundingClientRect = () => rect(60, 840);
  for (const row of rows) {
    const element = document.createElement("div");
    if (row.id) element.dataset.messageId = row.id;
    if (row.strip) {
      element.dataset.testid = "topic-feed-quest-start";
      element.dataset.quest = row.strip;
    }
    element.getBoundingClientRect = () => rect(row.top, 60);
    feed.appendChild(element);
  }
  column.appendChild(feed);
  document.body.appendChild(column);
  return feed;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("zooming between a quest and its topic", () => {
  it("lands the first message on screen at the same height in the new feed, once", () => {
    mountFeed("q-5", [
      { id: "m-1", top: 20 },
      { id: "m-2", top: 130 },
      { id: "hist-error-1", top: 200 },
    ]);
    const request = vi.spyOn(useStore.getState(), "requestScrollToMessage");
    prepareZoom("s1", "topic:q-5+q-9", "out", { feedKey: "q-5" });
    // Nothing happens until the topic feed is on screen.
    landZoom("s1", "q-5", null);
    expect(request).not.toHaveBeenCalled();
    landZoom("s1", "topic:q-5+q-9", null);
    expect(request).toHaveBeenCalledWith("s1", "m-2");
    expect(takeZoomPlacement("m-2")).toBe(30);
    expect(takeZoomPlacement("m-2")).toBeNull();
  });

  it("zooming in from a strip keeps that part's first message on screen", () => {
    // Messages of the part above the tapped strip's quest are skipped; so is the next part.
    mountFeed("topic:q-5+q-9", [
      { id: "a-1", top: 120 },
      { strip: "q-9", top: 100 },
      { id: "b-1", top: 40 },
      { id: "b-2", top: 160 },
      { strip: "q-5", top: 400 },
      { id: "c-1", top: 460 },
    ]);
    const part = document.querySelector<HTMLElement>('[data-quest="q-9"]');
    const request = vi.spyOn(useStore.getState(), "requestScrollToMessage");
    prepareZoom("s1", "q-9", "in", { feedKey: "topic:q-5+q-9", part });
    landZoom("s1", "q-9", null);
    expect(request).toHaveBeenCalledWith("s1", "b-2");
    expect(takeZoomPlacement("b-2")).toBe(60);
  });

  it("plays a scale from where the zoom happened, without a jump when there was no place to keep", () => {
    const column = document.createElement("div");
    const animate = vi.fn();
    column.animate = animate as never;
    const request = vi.spyOn(useStore.getState(), "requestScrollToMessage");
    request.mockClear();
    prepareZoom("s1", "topic:q-5+q-9", "out");
    landZoom("s1", "topic:q-5+q-9", column);
    expect(request).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "scale(1.05)" }, { transform: "scale(1)" }],
      expect.objectContaining({ duration: 320 }),
    );
    const [keyframes] = animate.mock.calls[0]!;
    expect(JSON.stringify(keyframes)).not.toContain("opacity");
  });
});
