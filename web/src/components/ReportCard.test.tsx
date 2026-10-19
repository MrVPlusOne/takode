// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportCard } from "./ReportCard.js";

// jsdom has no layout, so the report's measured height is stubbed per test.
function stubScrollHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(height);
}

afterEach(() => vi.restoreAllMocks());

describe("ReportCard", () => {
  it("clips a long report and toggles between full and clipped in place", () => {
    stubScrollHeight(2000);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <ReportCard>
        <p>Daily briefing</p>
      </ReportCard>,
    );

    const clip = screen.getByText("Daily briefing").parentElement!.parentElement!;
    const toggle = screen.getByRole("button", { name: "Show full report" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(clip.style.maxHeight).toBe("320px");

    fireEvent.click(toggle);
    const showLess = screen.getByRole("button", { name: "Show less" });
    expect(showLess).toHaveAttribute("aria-expanded", "true");
    expect(clip.style.maxHeight).toBe("");
    // An expanded report can run many screens, so its only collapse control sits
    // in a bar pinned to the feed's top, ahead of the report, not at its far end.
    expect(showLess.parentElement).toHaveClass("sticky");
    expect(showLess.compareDocumentPosition(clip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show full report" })).not.toBeInTheDocument();

    // Collapsing returns to the clipped preview and brings the card back on screen.
    fireEvent.click(showLess);
    expect(screen.getByRole("button", { name: "Show full report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show less" })).not.toBeInTheDocument();
    expect(clip.style.maxHeight).toBe("320px");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    vi.unstubAllGlobals();
  });

  it("shows a short report whole without a toggle", () => {
    stubScrollHeight(200);
    render(
      <ReportCard>
        <p>Short note</p>
      </ReportCard>,
    );

    expect(screen.getByText("Short note")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-card")).toBeInTheDocument();
  });
});
