// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapsedReportPreview } from "./CollapsedReportPreview.js";

// jsdom has no layout, so the report's measured height is stubbed per test.
function stubScrollHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(height);
}

afterEach(() => vi.restoreAllMocks());

describe("CollapsedReportPreview", () => {
  it("clips a long report and toggles between full and clipped in place", () => {
    stubScrollHeight(2000);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <CollapsedReportPreview>
        <p>Daily briefing</p>
      </CollapsedReportPreview>,
    );

    const clip = screen.getByText("Daily briefing").parentElement!.parentElement!;
    const toggle = screen.getByRole("button", { name: "Show full report" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(clip.style.maxHeight).toBe("320px");

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(clip.style.maxHeight).toBe("");

    // Collapsing returns to the clipped preview and keeps the toggle on screen.
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getByRole("button", { name: "Show full report" })).toBeInTheDocument();
    expect(clip.style.maxHeight).toBe("320px");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    vi.unstubAllGlobals();
  });

  it("shows a short report whole without a toggle", () => {
    stubScrollHeight(200);
    render(
      <CollapsedReportPreview>
        <p>Short note</p>
      </CollapsedReportPreview>,
    );

    expect(screen.getByText("Short note")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("collapsed-report")).toBeInTheDocument();
  });
});
