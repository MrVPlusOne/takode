// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { ContextMenu, useMenuButton } from "./ContextMenu.js";

function MenuButtonHarness() {
  const { menu, toggle, close } = useMenuButton();
  return (
    <>
      <button type="button" onClick={toggle}>
        Options
      </button>
      <button type="button">Elsewhere</button>
      {menu && <ContextMenu {...menu} items={[{ label: "Copy", onClick: () => {} }]} onClose={close} />}
    </>
  );
}

describe("useMenuButton", () => {
  it("closes the menu when its button is tapped again", () => {
    // The menu closes on any press outside it, and a tap sends touchstart and
    // mousedown before click. If the button counted as outside, the press would
    // close the menu and the click would toggle it straight back open.
    render(<MenuButtonHarness />);
    const button = screen.getByRole("button", { name: "Options" });

    fingerTap(button);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();

    fingerTap(button);
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("still closes the menu on a press anywhere else", () => {
    render(<MenuButtonHarness />);
    fingerTap(screen.getByRole("button", { name: "Options" }));

    fingerTap(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("opens the menu below its button", () => {
    render(<MenuButtonHarness />);
    const button = screen.getByRole("button", { name: "Options" });
    button.getBoundingClientRect = () => ({ left: 40, bottom: 100 }) as DOMRect;

    fingerTap(button);
    const menu = screen.getByRole("button", { name: "Copy" }).closest("[data-context-menu]");
    expect(menu).toHaveStyle({ left: "40px", top: "104px" });
  });
});

describe("ContextMenu submenus", () => {
  it("open inside the menu on a narrow screen with no room beside it, and close on a second tap", () => {
    // A side submenu that cannot fit would cover the row that opened it.
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 130,
      left: 40,
      right: 260,
      width: 220,
      height: 30,
      x: 40,
      y: 100,
      toJSON: () => ({}),
    });
    const copyMarkdown = vi.fn();
    try {
      render(
        <ContextMenu
          x={40}
          y={100}
          onClose={() => {}}
          items={[{ label: "Copy", onClick: () => {}, children: [{ label: "Markdown", onClick: copyMarkdown }] }]}
        />,
      );
      fingerTap(screen.getByRole("button", { name: "Copy" }));
      expect(screen.getByTestId("context-submenu-inline")).toContainElement(
        screen.getByRole("button", { name: "Markdown" }),
      );
      fingerTap(screen.getByRole("button", { name: "Copy" }));
      expect(screen.queryByRole("button", { name: "Markdown" })).toBeNull();
    } finally {
      rect.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
    }
  });
  it("opens inside the menu on a tap even with room beside it, and beside it for a mouse", () => {
    // A tap expands the submenu in place like a native touch menu, so a second
    // tap on the row closes it; a mouse keeps the side submenu.
    const items = [{ label: "Copy", onClick: () => {}, children: [{ label: "Markdown", onClick: () => {} }] }];
    const { unmount } = render(<ContextMenu x={10} y={100} onClose={() => {}} items={items} />);
    fingerTap(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByTestId("context-submenu-inline")).toContainElement(
      screen.getByRole("button", { name: "Markdown" }),
    );
    fingerTap(screen.getByRole("button", { name: "Copy" }));
    expect(screen.queryByRole("button", { name: "Markdown" })).toBeNull();
    unmount();

    render(<ContextMenu x={10} y={100} onClose={() => {}} items={items} />);
    const copy = screen.getByRole("button", { name: "Copy" });
    fireEvent.pointerDown(copy, { pointerType: "mouse" });
    fireEvent.click(copy);
    expect(screen.getByRole("button", { name: "Markdown" })).toBeTruthy();
    expect(screen.queryByTestId("context-submenu-inline")).toBeNull();
  });
});
