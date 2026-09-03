// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnToggleFooter } from "./CollapseFooter.js";

function ExpandedTurnToggle({ onToggle }: { onToggle: () => void }) {
  const headerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={headerRef} type="button">
        Turn summary
      </button>
      <TurnToggleFooter expanded headerRef={headerRef} onToggle={onToggle} />
    </>
  );
}

describe("TurnToggleFooter", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(hover: none) and (pointer: coarse)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers an accessible touch-sized Expand control with native keyboard behavior", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TurnToggleFooter expanded={false} onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Expand this turn" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("min-h-11", "touch-manipulation");
    expect(button).not.toHaveClass("sm:min-h-8");

    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing collapse-and-snap path behind a clear Collapse control", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ExpandedTurnToggle onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Collapse this turn" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveClass("min-h-11", "sm:min-h-8");
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
