// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { useStore } from "../store.js";
import { SidebarFoldStrip, SidebarLockToggle, useSidebarDropDown } from "./SidebarFold.js";

vi.mock("./SidebarTitleRow.js", () => ({
  SidebarTitleRow: () => (
    <div>
      <span data-sidebar-server-name>Takode</span>
      <button type="button">Back</button>
    </div>
  ),
}));

/** The folded row and the dropped panel as App lays them out, with a field to type in. */
function Harness({ enabled = true }: { enabled?: boolean }) {
  const dropDown = useSidebarDropDown(enabled);
  return (
    <>
      <SidebarFoldStrip dropDown={dropDown} style={{}} />
      <div ref={dropDown.panelRef} data-testid="panel" {...dropDown.hoverHandlers}>
        <input aria-label="Rename" />
      </div>
      <div data-testid="chat" />
    </>
  );
}

const strip = () => screen.getByTestId("sidebar-fold-strip");
const isOpen = () => strip().getAttribute("data-open") === "true";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({ sidebarLocked: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSidebarDropDown", () => {
  it("drops down when the mouse rests on the folded row and folds shortly after it leaves", () => {
    render(<Harness />);
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    expect(isOpen()).toBe(false);
    act(() => vi.advanceTimersByTime(100));
    expect(isOpen()).toBe(true);

    fireEvent.pointerLeave(strip(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(isOpen()).toBe(false);
  });

  it("does not flash open when the mouse only passes over the row", () => {
    render(<Harness />);
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(30));
    fireEvent.pointerLeave(strip(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(300));
    expect(isOpen()).toBe(false);
  });

  it("stays down while the mouse moves from the row into the dropped panel", () => {
    render(<Harness />);
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(100));

    fireEvent.pointerLeave(strip(), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByTestId("panel"), {
      pointerType: "mouse",
    });
    act(() => vi.advanceTimersByTime(500));
    expect(isOpen()).toBe(true);
  });

  // Renaming a session in the panel must not lose the field when the mouse drifts off.
  it("stays down while the user types in the panel", () => {
    render(<Harness />);
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(100));
    screen.getByLabelText("Rename").focus();

    fireEvent.pointerLeave(screen.getByTestId("panel"), {
      pointerType: "mouse",
    });
    act(() => vi.advanceTimersByTime(500));
    expect(isOpen()).toBe(true);
  });

  // Touch screens have no hover: a tap on the row drops the panel and a tap outside folds it.
  it("toggles on a touch tap and folds on a tap outside", () => {
    render(<Harness />);
    fireEvent.pointerDown(strip(), { pointerType: "touch" });
    fireEvent.click(strip());
    expect(isOpen()).toBe(true);

    fireEvent.pointerDown(screen.getByTestId("chat"), { pointerType: "touch" });
    expect(isOpen()).toBe(false);
  });

  it("stays down when a menu opened from the panel is pressed", () => {
    render(
      <>
        <Harness />
        <div data-context-menu="true" data-testid="menu" />
      </>,
    );
    fireEvent.pointerDown(strip(), { pointerType: "touch" });
    fireEvent.click(strip());
    fireEvent.pointerDown(screen.getByTestId("menu"), { pointerType: "touch" });
    expect(isOpen()).toBe(true);
  });

  it("leaves taps on the row's buttons and server name to them", () => {
    render(<Harness />);
    fireEvent.pointerDown(strip(), { pointerType: "touch" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByText("Takode"));
    expect(isOpen()).toBe(false);
  });

  it("folds when the panel is locked open again", () => {
    const view = render(<Harness />);
    fireEvent.pointerEnter(strip(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(100));
    view.rerender(<Harness enabled={false} />);
    expect(isOpen()).toBe(false);
  });
});

describe("SidebarLockToggle", () => {
  it("switches the panel between locked and folded and remembers the choice", () => {
    render(<SidebarLockToggle />);
    const toggle = screen.getByRole("button", {
      name: "Keep the sessions panel open",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(useStore.getState().sidebarLocked).toBe(false);
    expect(localStorage.getItem("cc-sidebar-locked")).toBe("false");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(useStore.getState().sidebarLocked).toBe(true);
    expect(localStorage.getItem("cc-sidebar-locked")).toBe("true");
  });
});
