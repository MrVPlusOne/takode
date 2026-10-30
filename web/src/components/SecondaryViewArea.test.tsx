// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecondaryViewArea } from "./SecondaryViewArea.js";
import type { SplitWidth } from "./SplitHandle.js";
import { setSecondaryViewTarget, useSecondaryViewTarget } from "../utils/secondary-view.js";

const SPLIT: SplitWidth = {
  width: 500,
  style: {},
  handleProps: {
    ...{ width: 500, min: 420, max: 1200, side: "right", defaultWidth: 500 },
    ...{ clamp: (value: number) => value, setWidth: () => {}, save: () => {} },
  },
};

function renderArea(props: Partial<Parameters<typeof SecondaryViewArea>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onDismiss: vi.fn() };
  const view = render(
    <SecondaryViewArea split={SPLIT} open title="Memory" contentRef={() => {}} {...handlers} {...props}>
      <div data-testid="page" />
    </SecondaryViewArea>,
  );
  return { ...handlers, view };
}

/**
 * The secondary view floats over the app: a click outside dismisses everything in it, Escape
 * closes what is on top, and focus moves into it while open and back out when it closes.
 */
describe("SecondaryViewArea", () => {
  afterEach(() => act(() => setSecondaryViewTarget(null)));

  it("closes the page from its header and dismisses everything on an outside click", () => {
    const { onClose, onDismiss } = renderArea();

    fireEvent.click(screen.getByRole("button", { name: "Close Memory" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("secondary-view-scrim"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // A page's absolutely positioned bits (such as sr-only labels) sit outside its own scroller.
  // Unclipped, they made the whole app scrollable past the end of the page; `clip` (unlike
  // `hidden`) also can't be scrolled by scrollIntoView.
  it("clips its content so a page can never make the app itself scrollable", () => {
    renderArea();
    expect(screen.getByTestId("secondary-view-pane")).toHaveClass("overflow-clip");
  });

  it("stays mounted but hidden while empty, so viewers keep a stable place to render", () => {
    renderArea({ open: false, title: undefined });
    expect(screen.getByTestId("secondary-view-pane")).toHaveClass("hidden");
    expect(screen.queryByTestId("secondary-view-scrim")).toBeNull();
  });

  // Escape closes the page, but not while a viewer over it handles its own Escape or while the
  // user types in one of the page's fields.
  it("closes the page on Escape unless a viewer or a field owns the key", () => {
    const { onClose } = renderArea();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const input = document.createElement("input");
    screen.getByTestId("page").appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => setSecondaryViewTarget(document.createElement("div")));
    renderHook(() => useSecondaryViewTarget(true, vi.fn(), "media"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Opening the view takes focus from the composer behind it; closing it gives focus back so the
  // user can keep typing.
  it("moves focus into the area while open and restores it on close", async () => {
    const composer = document.createElement("textarea");
    document.body.appendChild(composer);
    composer.focus();

    const { view } = renderArea({ open: false });
    expect(document.activeElement).toBe(composer);

    view.rerender(
      <SecondaryViewArea
        split={SPLIT}
        open
        title="Memory"
        contentRef={() => {}}
        onClose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(screen.getByTestId("secondary-view-pane"));

    view.rerender(
      <SecondaryViewArea split={SPLIT} open={false} contentRef={() => {}} onClose={vi.fn()} onDismiss={vi.fn()} />,
    );
    await act(async () => {});
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });
});
