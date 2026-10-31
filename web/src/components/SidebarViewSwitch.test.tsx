// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SidebarViewSwitch, useCompactWhenCrowded } from "./SidebarViewSwitch.js";

/**
 * The sessions panel's view switch: a segmented control when there is room, a dropdown when the
 * header is crowded, so the New button next to it is never pushed off the edge.
 */

/** A header row whose contents need `needed` px and whose own width is `width`. */
function Row({ width, needed, onSwitch }: { width: number; needed: number; onSwitch: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactWhenCrowded(ref);
  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (!element) return;
        Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
        Object.defineProperty(element, "scrollWidth", { configurable: true, value: Math.max(width, needed) });
      }}
    >
      <SidebarViewSwitch mode="topics" compact={compact} onSwitch={onSwitch} />
      <button type="button">New</button>
    </div>
  );
}

describe("SidebarViewSwitch", () => {
  it("shows the three views side by side when they fit", () => {
    render(<Row width={300} needed={260} onSwitch={() => {}} />);
    expect(screen.getByRole("group", { name: "Sidebar view" })).toBeTruthy();
    expect(screen.queryByTestId("sidebar-view-dropdown")).toBeNull();
  });

  it("turns into a dropdown naming the current view when the header is crowded, and switches from it", () => {
    const onSwitch = vi.fn();
    render(<Row width={220} needed={260} onSwitch={onSwitch} />);
    const dropdown = screen.getByTestId("sidebar-view-dropdown");
    expect(dropdown.textContent).toBe("Topics");
    fireEvent.click(dropdown);
    expect(screen.getByText("Topics ✓")).toBeTruthy();
    fireEvent.click(screen.getByText("Spaces"));
    expect(onSwitch).toHaveBeenCalledWith("spaces");
  });
});
