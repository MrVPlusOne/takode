// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecondaryViewArea } from "./SecondaryViewArea.js";
import { setSecondaryViewTarget, useSecondaryViewTarget } from "../utils/secondary-view.js";

function renderArea(props: Partial<Parameters<typeof SecondaryViewArea>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onDismiss: vi.fn() };
  const view = render(
    <SecondaryViewArea width={500} open title="Memory" contentRef={() => {}} {...handlers} {...props}>
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
      <SecondaryViewArea width={500} open title="Memory" contentRef={() => {}} onClose={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByTestId("secondary-view-pane"));

    view.rerender(
      <SecondaryViewArea width={500} open={false} contentRef={() => {}} onClose={vi.fn()} onDismiss={vi.fn()} />,
    );
    await act(async () => {});
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });
});
