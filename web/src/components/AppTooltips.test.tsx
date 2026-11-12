// @vitest-environment jsdom
/**
 * Takode draws every button's tooltip (Jiayi, Nov 2: every button should say what it does on
 * hover). The browser's own `title` tooltip came late and not at all for icon buttons named only by
 * `aria-label`; one page-wide listener now shows the same tooltip for both, beside the element.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTooltips, placeTooltip, TOOLTIP_DELAY_MS, tooltipFor } from "./AppTooltips.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A mouse pointer event (jsdom has no PointerEvent, so `pointerType` is set by hand). */
function pointer(type: "pointerover" | "pointerout" | "pointerdown", target: Element, related?: Element) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: related ?? null });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  act(() => {
    target.dispatchEvent(event);
  });
}

const icon = <svg aria-hidden="true" />;

describe("AppTooltips", () => {
  it("shows an icon button's aria-label after a short rest, and hides it when the mouse leaves", () => {
    vi.useFakeTimers();
    render(
      <>
        <AppTooltips />
        <button type="button" aria-label="Collapse the side column">
          {icon}
        </button>
        <span data-testid="elsewhere">elsewhere</span>
      </>,
    );
    const button = screen.getByRole("button");
    pointer("pointerover", button.querySelector("svg")!);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Collapse the side column");
    pointer("pointerout", button, screen.getByTestId("elsewhere"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a title instead of the browser's own tooltip, and gives the title back after", () => {
    vi.useFakeTimers();
    render(
      <>
        <AppTooltips />
        <button type="button" title="Start a new thread">
          {icon}
        </button>
      </>,
    );
    const button = screen.getByRole("button");
    pointer("pointerover", button);
    // Held back while ours shows, so the browser doesn't draw a second one.
    expect(button.hasAttribute("title")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Start a new thread");
    pointer("pointerdown", button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("title")).toBe("Start a new thread");
  });

  it("leaves touch alone", () => {
    vi.useFakeTimers();
    render(
      <>
        <AppTooltips />
        <button type="button" title="Collapse">
          {icon}
        </button>
      </>,
    );
    const event = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    act(() => {
      screen.getByRole("button").dispatchEvent(event);
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("tooltipFor", () => {
  it("uses a title, else the aria-label of a control with no text of its own", () => {
    document.body.innerHTML = `
      <button id="titled" title="Open in the main view" aria-label="Open"><svg></svg></button>
      <button id="icon" aria-label="Close"><svg></svg></button>
      <button id="text" aria-label="Start a new thread">New thread</button>
      <div role="button" id="row" aria-label="Fold"><span></span></div>`;
    const at = (id: string) =>
      tooltipFor(document.getElementById(id)!.firstElementChild ?? document.getElementById(id));
    expect(at("titled")?.text).toBe("Open in the main view");
    expect(at("icon")?.text).toBe("Close");
    // Its text already says what it does.
    expect(at("text")).toBeNull();
    expect(at("row")?.text).toBe("Fold");
    document.body.innerHTML = "";
  });
});

describe("placeTooltip", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 120, height: 24 };
  it("centres under the element, never over it", () => {
    expect(placeTooltip({ left: 440, top: 100, right: 480, bottom: 130 }, size, viewport)).toEqual({
      left: 400,
      top: 136,
    });
  });
  it("goes above when there is no room below, and stays inside the window", () => {
    expect(placeTooltip({ left: 980, top: 770, right: 996, bottom: 790 }, size, viewport)).toEqual({
      left: 874,
      top: 740,
    });
  });
});
