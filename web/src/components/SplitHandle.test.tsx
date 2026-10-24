// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { SplitHandle, useSplitWidth } from "./SplitHandle.js";
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

  it("grows a right-hand pane as the divider moves left", () => {
    render(<Split side="right" />);
    const handle = screen.getByRole("separator");
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "350");
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
