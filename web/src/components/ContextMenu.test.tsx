// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
