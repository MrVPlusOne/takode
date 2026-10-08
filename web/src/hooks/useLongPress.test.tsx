// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "../components/ContextMenu.js";
import { useLongPress } from "./useLongPress.js";

// The shared long-press behavior every mobile context menu uses. These tests
// replay what iOS Safari does after a long press: even with touchend
// cancelled it can still emulate mousedown/mouseup/click (and a hover) when
// the finger lifts, which used to dismiss the menu the moment it opened.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Target({ enabled = true }: { enabled?: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const longPress = useLongPress(enabled ? (x, y) => setMenu({ x, y }) : undefined);
  return (
    <>
      <button
        type="button"
        data-testid="target"
        data-pressing={longPress.pressing ? "true" : "false"}
        {...longPress.handlers}
        onClick={() => setLog((entries) => [...entries, "tap"])}
        onMouseEnter={() => {
          if (!longPress.isSuppressingMouse()) setLog((entries) => [...entries, "hover"]);
        }}
      >
        Target
      </button>
      <output data-testid="log">{log.join(",")}</output>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Action", onClick: () => setLog((entries) => [...entries, "action"]) }]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

const menuOpen = () => screen.queryByRole("button", { name: "Action" }) !== null;
const log = () => screen.getByTestId("log").textContent;

describe("useLongPress", () => {
  it("opens after 500 ms and survives iOS's emulated mouse events when the finger lifts", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    render(<Target />);
    const target = screen.getByTestId("target");

    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    // The target presses in while the long-press is pending.
    expect(target.dataset.pressing).toBe("true");
    act(() => vi.advanceTimersByTime(499));
    expect(menuOpen()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(menuOpen()).toBe(true);
    expect(target.dataset.pressing).toBe("false");
    // Android haptics; iOS has no web API for a mid-press tick.
    expect(vibrate).toHaveBeenCalledWith(10);

    const touchEnd = createEvent.touchEnd(target);
    fireEvent(target, touchEnd);
    expect(touchEnd.defaultPrevented).toBe(true);
    // The emulated sequence must neither dismiss the menu (mousedown reaches
    // the menu's outside-press listener) nor activate or hover the target.
    fireEvent.mouseOver(target);
    fireEvent.mouseDown(target);
    fireEvent.mouseUp(target);
    fireEvent.click(target);
    fireEvent.mouseDown(target);
    fireEvent.click(target);
    expect(menuOpen()).toBe(true);
    expect(log()).toBe("");

    // Menu items still work.
    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    expect(log()).toBe("action");
    expect(menuOpen()).toBe(false);
  });

  it("lets the next real tap through, and an outside touch dismisses the menu", () => {
    vi.useFakeTimers();
    render(<Target />);
    const target = screen.getByTestId("target");

    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(target);
    fireEvent.touchStart(document.body, { touches: [{ clientX: 300, clientY: 300 }] });
    expect(menuOpen()).toBe(false);

    // A real tap always starts with touchstart, which ends the suppression.
    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(target);
    fireEvent.mouseOver(target);
    fireEvent.mouseDown(target);
    fireEvent.click(target);
    // Positive control for the hover suppression above.
    expect(log()).toBe("hover,tap");
    expect(menuOpen()).toBe(false);
  });

  it("does not open when the finger moves, so scrolling and swiping are unaffected", () => {
    vi.useFakeTimers();
    render(<Target />);
    const target = screen.getByTestId("target");

    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 10, clientY: 30 }] });
    expect(target.dataset.pressing).toBe("false");
    act(() => vi.advanceTimersByTime(1000));
    expect(menuOpen()).toBe(false);
  });

  it("opens at the cursor on right-click, once even when Android also fires contextmenu", () => {
    vi.useFakeTimers();
    render(<Target />);
    const target = screen.getByTestId("target");

    const contextMenu = createEvent.contextMenu(target, { clientX: 40, clientY: 50 });
    fireEvent(target, contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(menuOpen()).toBe(true);
    fireEvent.mouseDown(document.body);
    expect(menuOpen()).toBe(false);

    // Android: the timer opens the menu, then the platform's own contextmenu
    // arrives for the same press and must not reopen or move it.
    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(500));
    const menu = screen.getByRole("button", { name: "Action" }).closest(".fixed") as HTMLElement;
    const top = menu.style.top;
    fireEvent.contextMenu(target, { clientX: 200, clientY: 200 });
    expect(menu.style.top).toBe(top);
  });

  it("leaves the browser's own menu alone when disabled", () => {
    vi.useFakeTimers();
    render(<Target enabled={false} />);
    const target = screen.getByTestId("target");

    const contextMenu = createEvent.contextMenu(target);
    fireEvent(target, contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);
    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    expect(target.dataset.pressing).toBe("false");
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(target);
    expect(menuOpen()).toBe(false);
    expect(log()).toBe("tap");
  });
});
