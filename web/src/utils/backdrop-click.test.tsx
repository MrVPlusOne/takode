// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backdropClickProps } from "./backdrop-click.js";

// The usual shape: a backdrop wrapping its dialog, whose own clicks stop at the dialog.
function Modal({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid="backdrop" {...backdropClickProps(onClose)}>
      <div role="dialog" onClick={(event) => event.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <p>Selectable text</p>
        <p>Other text</p>
      </div>
    </div>
  );
}

// A browser sends the click to the nearest element containing both ends of the press, so a drag
// across the dialog's edge arrives as a click on the backdrop. `press` fires exactly that.
function press(down: Element, up: Element, click: Element) {
  fireEvent.pointerDown(down);
  fireEvent.pointerUp(up);
  fireEvent.click(click);
}

describe("backdropClickProps", () => {
  it("closes on a plain click on the backdrop", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    const backdrop = screen.getByTestId("backdrop");
    press(backdrop, backdrop, backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when a text selection started inside the dialog ends on the backdrop", () => {
    // The reported bug: selecting text and letting go past the dialog's edge closed it. The
    // dialog stops pointerdown propagation too, which must not hide where the press began.
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    const backdrop = screen.getByTestId("backdrop");
    press(screen.getByText("Selectable text"), backdrop, backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when a press started on the backdrop ends inside the dialog", () => {
    // The click then reaches the backdrop as the common ancestor; the press did not stay outside.
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    const backdrop = screen.getByTestId("backdrop");
    press(backdrop, screen.getByText("Other text"), backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("forgets a press once its click is handled, so the next plain click still closes", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    const backdrop = screen.getByTestId("backdrop");
    press(screen.getByText("Selectable text"), backdrop, backdrop);
    press(backdrop, backdrop, backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("passes a click without a pointer press through, as for a keyboard or scripted click", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    fireEvent.click(screen.getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
