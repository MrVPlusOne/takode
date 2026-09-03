// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { useRef, useState } from "react";
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

function StatefulTurnToggle() {
  const [expanded, setExpanded] = useState(false);
  const headerRef = useRef<HTMLButtonElement>(null);
  return (
    <div data-turn-id="turn-focus">
      {expanded && (
        <button ref={headerRef} type="button">
          Turn summary
        </button>
      )}
      <TurnToggleFooter
        expanded={expanded}
        headerRef={expanded ? headerRef : undefined}
        onToggle={() => setExpanded((value) => !value)}
        toolCount={expanded ? 0 : 4}
      />
    </div>
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

  it("offers one accessible touch-sized Expand turn control with tool metadata", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TurnToggleFooter expanded={false} onToggle={onToggle} toolCount={3} />);

    const button = screen.getByRole("button", { name: "Expand turn · 3 tools" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("min-h-11", "touch-manipulation");
    expect(button).not.toHaveClass("sm:min-h-8");
    expect(screen.getAllByRole("button")).toHaveLength(1);

    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("uses the same lightweight action without metadata when there are no tools", () => {
    render(<TurnToggleFooter expanded={false} onToggle={() => {}} />);

    expect(screen.getByRole("button", { name: "Expand turn" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/tools?/i)).not.toBeInTheDocument();
  });

  it("uses singular tool copy", () => {
    render(<TurnToggleFooter expanded={false} onToggle={() => {}} toolCount={1} />);

    expect(screen.getByRole("button", { name: "Expand turn · 1 tool" })).toBeVisible();
  });

  it("keeps focus on the one replacement footer across both states", async () => {
    const user = userEvent.setup();
    render(<StatefulTurnToggle />);

    const expand = screen.getByRole("button", { name: "Expand turn · 4 tools" });
    expand.focus();
    await user.click(expand);
    const collapse = screen.getByRole("button", { name: "Collapse turn" });
    expect(document.activeElement).toBe(collapse);

    await user.click(collapse);
    const restoredExpand = screen.getByRole("button", { name: "Expand turn · 4 tools" });
    expect(document.activeElement).toBe(restoredExpand);
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

    const button = screen.getByRole("button", { name: "Collapse turn" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveClass("min-h-11", "sm:min-h-8");
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
