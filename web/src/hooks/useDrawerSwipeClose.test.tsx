// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { useDrawerSwipeClose } from "./useDrawerSwipeClose.js";

/**
 * A left-side drawer (the phone sessions panel) closes when swiped back toward the left edge.
 * The drawer is 400px wide here, so a quarter of its width is 100px.
 */
function Drawer({ onClose, enabled = true }: { onClose: () => void; enabled?: boolean }) {
  const swipe = useDrawerSwipeClose(onClose, enabled);
  return (
    <div data-testid="drawer" data-drag={swipe.dragPx ?? "none"} {...swipe.handlers}>
      <button type="button">Row</button>
      <input aria-label="Search" />
      <span data-session-drag-handle="true">Handle</span>
    </div>
  );
}

function renderDrawer(enabled = true) {
  const onClose = vi.fn();
  render(<Drawer onClose={onClose} enabled={enabled} />);
  const drawer = screen.getByTestId("drawer");
  drawer.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
  return { onClose, drawer };
}

/** Replays a one-finger drag lasting `slowMs` (the default is too slow to count as a flick). */
function drag(target: Element, from: [number, number], to: [number, number], slowMs = 1000) {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  fireEvent.touchStart(target, {
    touches: [{ clientX: from[0], clientY: from[1] }],
  });
  fireEvent.touchMove(target, {
    touches: [{ clientX: to[0], clientY: to[1] }],
  });
  now.mockReturnValue(slowMs);
  fireEvent.touchEnd(target, {
    changedTouches: [{ clientX: to[0], clientY: to[1] }],
  });
  now.mockRestore();
}

describe("useDrawerSwipeClose", () => {
  it("follows a leftward drag and closes once dragged past a quarter of the drawer", () => {
    const { onClose, drawer } = renderDrawer();
    const row = screen.getByText("Row");

    fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 180, clientY: 205 }] });
    expect(drawer).toHaveAttribute("data-drag", "-120");
    fireEvent.touchEnd(row, {
      changedTouches: [{ clientX: 180, clientY: 205 }],
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(drawer).toHaveAttribute("data-drag", "none");
  });

  it("springs back from a short slow drag", () => {
    const { onClose, drawer } = renderDrawer();
    drag(screen.getByText("Row"), [300, 200], [240, 200]);
    expect(onClose).not.toHaveBeenCalled();
    expect(drawer).toHaveAttribute("data-drag", "none");
  });

  it("closes on a quick short flick", () => {
    const { onClose } = renderDrawer();
    drag(screen.getByText("Row"), [300, 200], [250, 200], 150);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores rightward drags, vertical scrolls and touches on inputs or reorder handles", () => {
    const { onClose, drawer } = renderDrawer();
    drag(screen.getByText("Row"), [100, 200], [300, 200]);
    drag(screen.getByText("Row"), [300, 100], [180, 400]);
    drag(screen.getByLabelText("Search"), [300, 200], [100, 200]);
    drag(screen.getByText("Handle"), [300, 200], [100, 200]);
    expect(onClose).not.toHaveBeenCalled();
    expect(drawer).toHaveAttribute("data-drag", "none");
  });

  it("does nothing while disabled", () => {
    const { onClose } = renderDrawer(false);
    drag(screen.getByText("Row"), [300, 200], [100, 200]);
    expect(onClose).not.toHaveBeenCalled();
  });
});
