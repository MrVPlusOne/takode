// @vitest-environment jsdom
/**
 * Completion celebrations: what each one lays over the page, that nothing takes taps or
 * outlives its timer, that reduced motion plays nothing, and that an event plays only when
 * it is new and only once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ARRIVAL_WINDOW_MS,
  _resetArrivalsForTest,
  celebrationAnchor,
  playCheckPop,
  playCompletionCelebration,
  playSparkle,
  usePlayOnArrival,
} from "./completion-celebration.js";

let animate: ReturnType<typeof vi.fn>;

function setup({ reducedMotion = false } = {}) {
  vi.useFakeTimers();
  animate = vi.fn(() => ({}) as Animation);
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  // jsdom lays nothing out, so elements get the size a browser would give them.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({ matches: reducedMotion && query === "(prefers-reduced-motion: reduce)", media: query }) as MediaQueryList,
  );
}

/** A to-do row as the list renders it: an article with its status circle and text. */
function todoRow() {
  const row = document.createElement("article");
  row.dataset.todoId = "td-1";
  row.innerHTML =
    '<button aria-label="Complete Renew passport"><span>✓</span></button><div role="button" aria-label="Open Renew passport">Renew passport</div>';
  document.body.appendChild(row);
  return { row, check: row.querySelector("button")! };
}

beforeEach(() => _resetArrivalsForTest());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
});

describe("playCompletionCelebration", () => {
  it("lays a struck-through copy of the row over its place, with the check riding on the copy", () => {
    setup();
    const { row, check } = todoRow();
    const anchor = celebrationAnchor(check, row);
    // The list removes the completed row before the celebration plays.
    row.remove();
    playCompletionCelebration(anchor);

    const ghost = document.querySelector<HTMLElement>("[data-completion-ghost]")!;
    // The copy is decoration only: hidden from assistive tech, never tapped or focused, and
    // never mistaken for the real row or its controls by queries.
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.hasAttribute("inert")).toBe(true);
    expect(ghost.style.pointerEvents).toBe("none");
    expect(ghost.style.textDecoration).toBe("line-through");
    expect(ghost.dataset.todoId).toBeUndefined();
    expect(ghost.querySelector("[aria-label]")).toBeNull();
    // The check pops on the copy, so it slides away with the row instead of sitting over
    // the next row's circle.
    expect(ghost.querySelector("[data-completion-mark]")!.children).toHaveLength(1);
    const layer = document.querySelector<HTMLElement>("[data-celebration]")!;
    expect(layer.style.pointerEvents).toBe("none");
    // Confetti bits, the check, and the copy's slide.
    expect(layer.children.length).toBeGreaterThan(10);
    expect(animate).toHaveBeenCalledWith(
      [{ translate: "0 0" }, { translate: "0 0", offset: 0.5 }, { translate: "100% 0" }],
      expect.objectContaining({ duration: 900 }),
    );

    // A timer removes everything even if the page never delivers the finish events.
    vi.advanceTimersByTime(1000);
    expect(document.querySelector("[data-completion-ghost]")).toBeNull();
    expect(document.querySelector("[data-celebration]")).toBeNull();
  });

  it("plays nothing with reduced motion, or when the circle is not on screen", () => {
    setup({ reducedMotion: true });
    const { row, check } = todoRow();
    playCompletionCelebration(celebrationAnchor(check, row));
    playCheckPop(celebrationAnchor(check));
    playSparkle(celebrationAnchor(check));
    expect(document.querySelector("[data-celebration], [data-completion-ghost]")).toBeNull();

    expect(celebrationAnchor(null)).toBeNull();
  });
});

describe("playCheckPop and playSparkle", () => {
  it("draw at the anchor and clean up after themselves", () => {
    setup();
    const target = document.createElement("span");
    document.body.appendChild(target);
    playCheckPop(celebrationAnchor(target));
    playSparkle(celebrationAnchor(target));
    expect(document.querySelectorAll("[data-celebration]")).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(document.querySelector("[data-celebration]")).toBeNull();
  });
});

describe("usePlayOnArrival", () => {
  function Event({ id, at, play }: { id: string | null; at?: number; play: () => void }) {
    usePlayOnArrival(id, at, play);
    return null;
  }

  it("plays once for an event that just happened, and never for older ones", () => {
    const play = vi.fn();
    const { rerender, unmount } = render(<Event id="landed:1" at={Date.now() - 1_000} play={play} />);
    expect(play).toHaveBeenCalledTimes(1);
    // Re-rendering, or the feed remounting the row, does not replay it.
    rerender(<Event id="landed:1" at={Date.now() - 1_000} play={play} />);
    unmount();
    render(<Event id="landed:1" at={Date.now() - 1_000} play={play} />);
    expect(play).toHaveBeenCalledTimes(1);

    // History: an event older than the arrival window shows quietly.
    render(<Event id="landed:2" at={Date.now() - ARRIVAL_WINDOW_MS - 1_000} play={play} />);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("waits until there is an event, then plays when it arrives", () => {
    // A quest card renders before its quest is done; the key appears when it completes.
    const play = vi.fn();
    const { rerender } = render(<Event id={null} play={play} />);
    expect(play).not.toHaveBeenCalled();
    rerender(<Event id="quest-complete:q-1:5" at={Date.now()} play={play} />);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
