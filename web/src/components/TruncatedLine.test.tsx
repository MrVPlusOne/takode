// @vitest-environment jsdom
/**
 * A line cut to one line with its full text in a card (Jiayi, Nov 1: Home's news lines wrapped and
 * made rows uneven). The card shows only when the text is actually cut: after the mouse rests on
 * it, or after a long-press on touch, and closes when the mouse leaves or on the next press.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TruncatedLine } from "./TruncatedLine.js";

const TEXT =
  "Done: desktop gets a slimmer status row and one folded quest chip, with worker and commits in its drop-down";

/** jsdom has no layout: say how wide the text is against its box. */
function stubWidths(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TruncatedLine", () => {
  it("shows the full text after the mouse rests on a cut line, and hides it when the mouse leaves", () => {
    vi.useFakeTimers();
    stubWidths(900, 400);
    render(<TruncatedLine text={TEXT} testId="line" />);
    const line = screen.getByTestId("line");
    expect(line.className).toContain("truncate");
    fireEvent.pointerEnter(line, { pointerType: "mouse" });
    expect(screen.queryByTestId("truncated-line-card")).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByTestId("truncated-line-card").textContent).toBe(TEXT);
    fireEvent.pointerLeave(line, { pointerType: "mouse" });
    expect(screen.queryByTestId("truncated-line-card")).toBeNull();
  });

  it("shows nothing for a line that fits", () => {
    vi.useFakeTimers();
    stubWidths(300, 400);
    render(<TruncatedLine text="Short" testId="line" />);
    fireEvent.pointerEnter(screen.getByTestId("line"), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByTestId("truncated-line-card")).toBeNull();
  });

  it("shows the full text on a touch long-press, closing on the next press", () => {
    vi.useFakeTimers();
    stubWidths(900, 400);
    render(<TruncatedLine text={TEXT} testId="line" />);
    const line = screen.getByTestId("line");
    fireEvent.touchStart(line, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.touchEnd(line);
    expect(screen.getByTestId("truncated-line-card").textContent).toBe(TEXT);
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(screen.queryByTestId("truncated-line-card")).toBeNull();
  });
});
