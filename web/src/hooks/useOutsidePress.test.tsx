// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef, useState } from "react";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { useOutsidePress } from "./useOutsidePress.js";

/** A trigger that toggles a surface, plus a portaled-style layer and an unrelated button. */
function Harness({ onOutsidePress }: { onOutsidePress?: () => void }) {
  const [open, setOpen] = useState(true);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useOutsidePress(
    [surfaceRef, triggerRef, "[data-test-layer]"],
    () => {
      onOutsidePress?.();
      setOpen(false);
    },
    open,
  );
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}>
        Trigger
      </button>
      {open && (
        <div ref={surfaceRef} data-testid="surface">
          <button type="button">Inside</button>
        </div>
      )}
      <div data-test-layer>
        <button type="button">Layer</button>
      </div>
      {/* Handlers deep in the page may stop propagation; that must not keep the surface open. */}
      <button type="button" onPointerDown={(event) => event.stopPropagation()}>
        Stopper
      </button>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe("useOutsidePress", () => {
  it("closes on a press outside, and stays open for presses inside, on the trigger or in a named layer", () => {
    render(<Harness />);
    for (const name of ["Inside", "Layer"]) {
      fingerTap(screen.getByRole("button", { name }));
      expect(screen.getByTestId("surface")).toBeInTheDocument();
    }

    fingerTap(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("lets a second tap on the trigger close the surface instead of reopening it", () => {
    // A tap's press comes before its click. Were the trigger outside, the press
    // would close the surface and the click would toggle it straight back open.
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Trigger" });

    fingerTap(trigger);
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
    fingerTap(trigger);
    expect(screen.getByTestId("surface")).toBeInTheDocument();
  });

  it("closes on the press itself, before any click, even where a handler stops propagation", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Stopper" }), { pointerType: "touch" });
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("ignores presses while disabled or while the surface is not in the page", () => {
    const onOutsidePress = vi.fn();
    function Unmounted() {
      const surfaceRef = useRef<HTMLDivElement>(null);
      useOutsidePress([surfaceRef], onOutsidePress);
      return <button type="button">Elsewhere</button>;
    }
    render(<Unmounted />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onOutsidePress).not.toHaveBeenCalled();

    // Once closed (enabled = false), further presses do nothing.
    const { unmount } = render(<Harness onOutsidePress={onOutsidePress} />);
    const elsewhere = screen.getAllByRole("button", { name: "Elsewhere" }).at(-1)!;
    fireEvent.pointerDown(elsewhere);
    fireEvent.pointerDown(elsewhere);
    expect(onOutsidePress).toHaveBeenCalledTimes(1);
    unmount();
  });
});
