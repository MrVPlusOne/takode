// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { StackedPanes } from "./StackedPanes.js";

/**
 * Groups in one panel work like VS Code's side bar (Jiayi, Oct 30): each folds from its header and
 * scrolls on its own, and the line between two open groups drags to set their proportions. Folds and
 * sizes are kept per stack in this browser.
 */
const panes = () => [
  { id: "a", title: "Topics", children: <p>topics</p> },
  { id: "b", title: "Leaders", children: <p>leaders</p> },
  { id: "c", title: "Other sessions", children: <p>sessions</p> },
];

describe("StackedPanes", () => {
  beforeEach(() => localStorage.clear());

  it("folds a group from its header and remembers it", () => {
    const { unmount } = render(<StackedPanes stackId="test" panes={panes()} />);
    fireEvent.click(screen.getByRole("button", { name: /Leaders/ }));
    expect(screen.queryByText("leaders")).toBeNull();
    expect(screen.getByRole("button", { name: /Leaders/ }).getAttribute("aria-expanded")).toBe("false");
    unmount();
    // A new mount (another visit) starts folded the same way.
    render(<StackedPanes stackId="test" panes={panes()} />);
    expect(screen.queryByText("leaders")).toBeNull();
    expect(screen.getByText("topics")).toBeTruthy();
  });

  it("moves height between the open groups around a divider and keeps it", () => {
    render(<StackedPanes stackId="test" panes={panes()} />);
    // jsdom has no layout: give the groups heights to move between.
    for (const [index, pane] of screen.getAllByTestId("stacked-pane").entries()) {
      pane.getBoundingClientRect = () => ({ height: [300, 100, 200][index] }) as DOMRect;
    }
    const [first] = screen.getAllByTestId("stacked-pane-divider");
    // The keyboard moves the line too: down grows the group above.
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    const saved = JSON.parse(localStorage.getItem("cc-stacked-panes") ?? "{}").test;
    expect(saved.weights).toEqual({ a: 324, b: 76, c: 200 });
    // The open groups share the height by those weights.
    expect(screen.getAllByTestId("stacked-pane").map((pane) => pane.style.flexGrow)).toEqual(["324", "76", "200"]);
  });

  it("has no divider to drag next to a folded group", () => {
    render(<StackedPanes stackId="test" panes={panes()} />);
    fireEvent.click(screen.getByRole("button", { name: /Leaders/ }));
    // Above Leaders (folded) and above Other sessions (whose open neighbour above is Topics): only one.
    expect(screen.getAllByTestId("stacked-pane-divider")).toHaveLength(1);
  });
});
