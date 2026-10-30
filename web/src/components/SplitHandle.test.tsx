// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { SplitHandle, useSplitWidth } from "./SplitHandle.js";
import { useStore } from "../store.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { useLibraryNav } from "../utils/library-nav.js";

/**
 * Draggable dividers: dragging resizes the pane within its limits and the width is remembered per
 * split; double-click resets it and the arrow keys move it. A pane on the right grows as the
 * divider moves left. Also: artifact links in Markdown open the Library at the linked version.
 */

afterEach(() => localStorage.clear());

function Split({ side = "left" as "left" | "right" }) {
  const split = useSplitWidth("test-split", { defaultWidth: 300, min: 200, max: 500, side });
  return (
    <div>
      <div data-testid="pane" style={split.style} />
      <SplitHandle label="Resize the list" {...split.handleProps} />
    </div>
  );
}

describe("SplitHandle", () => {
  it("resizes by dragging within the limits and remembers the width", () => {
    const { unmount } = render(<Split />);
    const handle = screen.getByRole("separator", { name: "Resize the list" });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "360");
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "500");
    fireEvent.pointerUp(handle, { pointerId: 1 });
    unmount();

    render(<Split />);
    expect(screen.getByTestId("pane").style.getPropertyValue("--split-w")).toBe("500px");
    const again = screen.getByRole("separator");
    fireEvent.keyDown(again, { key: "ArrowLeft" });
    expect(again).toHaveAttribute("aria-valuenow", "484");
    fireEvent.doubleClick(again);
    expect(again).toHaveAttribute("aria-valuenow", "300");
  });

  it("shares a saved width with other mounted panes of the same split", () => {
    // Each leader's view keeps its topic panel mounted; resizing one must not leave the others behind.
    render(
      <>
        <Split />
        <Split />
      </>,
    );
    const [first, second] = screen.getAllByRole("separator");
    fireEvent.keyDown(first!, { key: "ArrowRight", shiftKey: true });
    expect(first).toHaveAttribute("aria-valuenow", "364");
    expect(second).toHaveAttribute("aria-valuenow", "364");
  });

  it("grows a right-hand pane as the divider moves left", () => {
    render(<Split side="right" />);
    const handle = screen.getByRole("separator");
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "350");
  });
});

describe("SplitHandle sharing the window", () => {
  function SharedSplit() {
    const split = useSplitWidth("test-share", { defaultWidth: 300, min: 200, max: 2000, side: "right", share: true });
    return <SplitHandle label="Resize the panel" {...split.handleProps} />;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("keeps a dragged width as a share of the window, so it follows the window's size", () => {
    // The user widens the panel to 600 of 1000 px; the window doubles and the panel with it.
    useStore.setState({ zoomLevel: 1 });
    vi.stubGlobal("innerWidth", 1000);
    render(<SharedSplit />);
    const handle = screen.getByRole("separator");
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "600");
    expect(JSON.parse(localStorage.getItem("cc-split-widths")!)).toEqual({ "test-share": 0.6 });

    act(() => {
      vi.stubGlobal("innerWidth", 2000);
      window.dispatchEvent(new Event("resize"));
    });
    expect(handle).toHaveAttribute("aria-valuenow", "1200");
    // Narrower than the share allows: the rest of the window keeps its room.
    act(() => {
      vi.stubGlobal("innerWidth", 700);
      window.dispatchEvent(new Event("resize"));
    });
    expect(handle).toHaveAttribute("aria-valuenow", "380");
  });
});

describe("artifact links", () => {
  it("render as Library links that open the linked version", () => {
    render(<MarkdownContent text="See [T7 thread update](artifact:7a6b5c4d:v2)." />);
    const link = screen.getByTestId("artifact-inline-link");
    expect(link).toHaveTextContent("T7 thread update");
    fireEvent.click(link, { button: 0 });
    expect(useLibraryNav.getState()).toMatchObject({ artifactId: "7a6b5c4d", version: 2 });
  });
});
