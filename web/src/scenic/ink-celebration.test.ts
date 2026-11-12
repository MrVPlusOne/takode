// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Point, type Rect, findSealSpot, inkSealSvg, pickBursts, playInkCelebration } from "./ink-celebration.js";

function box(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** Whether a seal of `width` x `height` centred at `spot` keeps `gap` clear of every word. */
function clearOf(words: Rect[], spot: Point, width: number, height: number, gap: number): boolean {
  return words.every(
    (word) =>
      spot.x + width / 2 + gap <= word.left ||
      spot.x - width / 2 - gap >= word.right ||
      spot.y + height / 2 + gap <= word.top ||
      spot.y - height / 2 - gap >= word.bottom,
  );
}

describe("findSealSpot", () => {
  // A 400 x 200 card in a wide pane; the seal is 40 x 76.
  const card = box(100, 100, 400, 200);
  const pane = box(0, 0, 1000, 800);

  it("presses the seal across the card's right edge, low on the card, when nothing is in the way", () => {
    const spot = findSealSpot(card, pane, [], 40, 76);
    expect(spot).toEqual({ x: card.right, y: card.bottom - 38 - 6 });
  });

  it("moves up past lines that reach the card's right edge and never touches writing", () => {
    // Jiayi's rule for the seal (from the review): a seal never covers writing. The two lowest
    // lines run to the card's edge, so the seal must sit above them.
    const words = [box(110, 110, 380, 18), box(110, 250, 385, 18), box(110, 272, 386, 18)];
    const spot = findSealSpot(card, pane, words, 40, 76)!;
    expect(spot.x).toBe(card.right);
    expect(spot.y + 38).toBeLessThanOrEqual(250 - 6);
    expect(clearOf(words, spot, 40, 76, 6)).toBe(true);
  });

  it("moves outward when long lines fill the card's whole height, staying inside the pane", () => {
    const words = Array.from({ length: 10 }, (_, line) => box(110, 102 + line * 20, 386, 18));
    const spot = findSealSpot(card, pane, words, 40, 76)!;
    expect(spot.x).toBeGreaterThan(card.right);
    expect(spot.x + 20).toBeLessThanOrEqual(pane.right);
    expect(clearOf(words, spot, 40, 76, 6)).toBe(true);
  });

  it("leaves the seal out when there is no clear spot", () => {
    const words = Array.from({ length: 10 }, (_, line) => box(110, 102 + line * 20, 386, 18));
    expect(findSealSpot(card, box(0, 0, 505, 800), words, 40, 76)).toBeNull();
  });
});

describe("pickBursts", () => {
  /** Open points `step` apart covering `area`. */
  function grid(area: Rect, step: number): Point[] {
    const points: Point[] = [];
    for (let y = area.top + step / 2; y < area.bottom; y += step)
      for (let x = area.left + step / 2; x < area.right; x += step) points.push({ x, y });
    return points;
  }

  it("aims a wide desktop's bursts at open sky, not in front of the painting's cliffs", () => {
    // The column covers the middle; painting shows on both sides of it. A cliff stands in the
    // left margin and a tall peak in the upper right margin; the bursts must open elsewhere.
    const region = box(0, 0, 1800, 900);
    const column = box(500, 0, 800, 900);
    const step = 20;
    const open = [...grid(box(0, 0, 500, 900), step), ...grid(box(1300, 0, 500, 900), step)];
    const cliffs = (x: number, y: number) => (x < 450 || (x > 1450 && x < 1600 && y < 400) ? 1 : 0);
    const bursts = pickBursts({ region, column, card: box(520, 600, 760, 200), open, step, cliffs });
    expect(bursts).toHaveLength(3);
    for (const burst of bursts) expect(cliffs(burst.x, burst.y)).toBe(0);
    // Bigger on wide screens, where they never come near text.
    for (const burst of bursts) expect(burst.radius).toBeGreaterThanOrEqual(100 * 0.85);
  });

  it("aims a narrow pane's bursts at the painting showing near the card, kept apart", () => {
    // A phone: the only painting showing is the gap row above the card and the far top gap.
    const region = box(0, 0, 430, 800);
    const card = box(16, 400, 398, 300);
    const step = 10;
    const nearGap = grid(box(0, 360, 430, 30), step);
    const farGap = grid(box(0, 20, 430, 30), step);
    const bursts = pickBursts({
      region,
      column: box(16, 0, 398, 800),
      card,
      open: [...nearGap, ...farGap],
      step,
      cliffs: null,
    });
    expect(bursts).toHaveLength(3);
    expect(bursts[0]!.y).toBeGreaterThanOrEqual(360);
    expect(bursts[0]!.y).toBeLessThanOrEqual(390);
    for (const [index, burst] of bursts.entries())
      for (const other of bursts.slice(index + 1))
        expect(Math.hypot(burst.x - other.x, burst.y - other.y)).toBeGreaterThanOrEqual(burst.radius);
  });
});

describe("inkSealSvg", () => {
  it("draws its characters as outlines, so no font is involved", () => {
    const svg = inkSealSvg(["圆", "满"], 40, 76, false);
    expect(svg).toContain("<path d=");
    expect(svg).not.toMatch(/<text|font/);
  });
});

describe("playInkCelebration", () => {
  const rects = new Map<Element, Rect>();
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const rect = rects.get(this) ?? box(0, 0, 0, 0);
      return { ...rect, x: rect.left, y: rect.top, toJSON: () => rect } as DOMRect;
    });
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
    HTMLElement.prototype.animate = vi.fn(() => ({ cancel() {}, currentTime: 0 })) as unknown as HTMLElement["animate"];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rects.clear();
    document.body.innerHTML = "";
  });

  /** A conversation pane (`main-chat` or a side chat) holding a feed with a completion card. */
  function pane(testId: string): { root: HTMLElement; holder: HTMLElement; label: HTMLElement } {
    const root = document.createElement("div");
    root.dataset.testid = testId;
    root.innerHTML =
      '<div class="layout" style="position: relative"><div data-testid="message-feed-scroll-container">' +
      '<div data-feed-content-root="true"><div data-testid="quest-completion-summary"><span class="label">Quest complete</span></div></div>' +
      "</div></div>";
    document.body.appendChild(root);
    rects.set(root, box(0, 0, 800, 600));
    for (const element of root.querySelectorAll("*")) rects.set(element, box(0, 0, 800, 600));
    return {
      root,
      holder: root.querySelector<HTMLElement>(".layout")!,
      label: root.querySelector<HTMLElement>(".label")!,
    };
  }

  it("plays in the side chat that holds the card, under that chat's messages", async () => {
    // A quest finishing in a side-column chat celebrates there, not in the main conversation, and
    // its fireworks go under the feed (before its positioned layout box), so no text is covered.
    const main = pane("main-chat");
    const side = pane("side-item-body");
    playInkCelebration(side.label, true);
    await vi.waitFor(() => expect(side.root.querySelector("[data-scenic-moment]")).not.toBeNull());
    expect(side.holder.previousElementSibling?.hasAttribute("data-scenic-moment")).toBe(true);
    expect(main.root.querySelector("[data-scenic-moment]")).toBeNull();
  });
});
