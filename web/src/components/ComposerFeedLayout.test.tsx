// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerFeedLayout, useComposerOverlayMeasurement, useComposerScrollSpace } from "./ComposerFeedLayout.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function MeasuredComposer() {
  const root = useRef<HTMLDivElement>(null);
  useComposerOverlayMeasurement(root, true);
  return (
    <div data-testid="dock">
      <div ref={root} data-testid="boundary" />
    </div>
  );
}

function Clearance() {
  return <output>{useComposerScrollSpace("main")}</output>;
}

it("reserves nothing for an in-flow composer and measures overlay clearance in layout pixels", () => {
  // Touch CSS sizes the dock with its contents. CSS zoom affects client rectangles,
  // not offsetHeight: subtracting two layout heights avoids over/under-reserving.
  let dockHeight = 310;
  let notify: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === "dock" ? dockHeight : this.dataset.testid === "boundary" ? 310 : 0;
  });
  const view = render(
    <ComposerFeedLayout>
      <Clearance />
      <MeasuredComposer />
    </ComposerFeedLayout>,
  );
  expect(screen.getByRole("status").textContent).toBe("0");
  act(() => {
    dockHeight = 70;
    notify();
  });
  expect(screen.getByRole("status").textContent).toBe("240");
  act(() => {
    dockHeight = 310;
    notify();
  });
  expect(screen.getByRole("status").textContent).toBe("240");
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
