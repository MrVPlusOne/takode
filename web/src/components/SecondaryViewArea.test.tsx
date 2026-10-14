// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecondaryViewArea } from "./SecondaryViewArea.js";
import { setSecondaryViewMode, useSecondaryViewMode } from "../utils/secondary-view.js";

function renderArea(props: Partial<Parameters<typeof SecondaryViewArea>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onDismiss: vi.fn() };
  render(
    <SecondaryViewArea
      width={500}
      open
      mode="side"
      canShowBeside
      title="Memory"
      contentRef={() => {}}
      {...handlers}
      {...props}
    >
      <div data-testid="page" />
    </SecondaryViewArea>,
  );
  return handlers;
}

/**
 * The right-hand area either sits beside the conversation, where working in the chat leaves it
 * open, or floats over it, where a click outside dismisses it. A small toggle switches the two.
 */
describe("SecondaryViewArea", () => {
  afterEach(() => setSecondaryViewMode("side"));

  it("stays open beside the conversation with no outside-click catcher", () => {
    const { onClose } = renderArea();

    expect(screen.getByTestId("secondary-view-pane")).toHaveAttribute("data-mode", "side");
    expect(screen.queryByTestId("secondary-view-scrim")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Memory" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses everything on an outside click while floating over the conversation", () => {
    const { onDismiss } = renderArea({ mode: "overlay" });

    fireEvent.click(screen.getByTestId("secondary-view-scrim"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("switches the remembered mode from its edge toggle", () => {
    function ModeProbe() {
      return <span data-testid="mode">{useSecondaryViewMode()}</span>;
    }
    render(<ModeProbe />);
    renderArea();

    fireEvent.click(screen.getByRole("button", { name: "Show over the conversation" }));
    expect(screen.getByTestId("mode")).toHaveTextContent("overlay");
  });

  it("hides the toggle when the window is too narrow to show the area beside the conversation", () => {
    renderArea({ mode: "overlay", canShowBeside: false });
    expect(screen.queryByTestId("secondary-view-mode-toggle")).toBeNull();
  });

  it("stays mounted but hidden while empty, so viewers keep a stable place to render", () => {
    renderArea({ open: false, title: undefined });
    expect(screen.getByTestId("secondary-view-pane")).toHaveClass("hidden");
    expect(screen.queryByTestId("secondary-view-scrim")).toBeNull();
  });
});
