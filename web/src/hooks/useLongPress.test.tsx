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

function Target({ enabled = true, anchor }: { enabled?: boolean; anchor?: "target" | "press" }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const longPress = useLongPress(enabled ? (x, y) => setMenu({ x, y }) : undefined, { anchor });
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

    // iOS aims the emulated events at whatever is under the finger at lift.
    // A target near the bottom of the screen gets its menu moved up into view,
    // over the finger, so the lift must not choose the item under it either.
    const action = screen.getByRole("button", { name: "Action" });
    fireEvent.mouseDown(action);
    fireEvent.mouseUp(action);
    fireEvent.click(action);
    expect(menuOpen()).toBe(true);
    expect(log()).toBe("");

    // Menu items still work: a real tap starts with touchstart.
    fireEvent.touchStart(action, { touches: [{ clientX: 10, clientY: 60 }] });
    fireEvent.touchEnd(action);
    fireEvent.mouseDown(action);
    fireEvent.click(action);
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

  it("lets a real mouse click through right after a touch long-press", () => {
    // Touch-screen laptops: a real mouse announces itself with a mouse
    // pointerdown, which ends the suppression meant for iOS's emulated events.
    vi.useFakeTimers();
    render(<Target />);
    const target = screen.getByTestId("target");
    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(target);

    const action = screen.getByRole("button", { name: "Action" });
    fireEvent.pointerDown(action, { pointerType: "mouse" });
    fireEvent.mouseDown(action);
    fireEvent.click(action);
    expect(log()).toBe("action");
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

  it("opens below the target by default, or at the press point for large surfaces", () => {
    vi.useFakeTimers();
    const menuPosition = () => {
      const menu = screen.getByRole("button", { name: "Action" }).closest(".fixed") as HTMLElement;
      return { left: menu.style.left, top: menu.style.top };
    };
    const { unmount } = render(<Target />);
    const target = screen.getByTestId("target");
    // jsdom gives the target an all-zero rect, so "below the target" is (0, 4).
    fireEvent.touchStart(target, { touches: [{ clientX: 30, clientY: 40 }] });
    act(() => vi.advanceTimersByTime(500));
    expect(menuPosition()).toEqual({ left: "0px", top: "4px" });
    unmount();

    // A full-screen surface like the terminal: below it would be off screen,
    // so the menu opens just under the finger.
    render(<Target anchor="press" />);
    fireEvent.touchStart(screen.getByTestId("target"), { touches: [{ clientX: 30, clientY: 40 }] });
    act(() => vi.advanceTimersByTime(500));
    expect(menuPosition()).toEqual({ left: "30px", top: "44px" });
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
