// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fingerTap } from "../test-fixtures/finger-tap.js";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";

const TABLE = "| Domain | Share |\n| --- | --- |\n| SWE | 15.5% |";

// Copy and View table float over the table and stay out of sight until wanted, so a page of
// tables reads cleanly. A mouse reveals them by hovering (CSS); touch has no hover, so a tap on
// the table shows them until a press lands elsewhere.
describe("table controls", () => {
  it("float over the table and are hidden by default, taking no taps while hidden", () => {
    render(<MarkdownContent text={TABLE} />);
    const controls = screen.getByTestId("markdown-table-controls");
    expect(controls.className).toContain("absolute");
    expect(controls.className).toContain("opacity-0");
    // Invisible buttons over the header must not catch a tap meant for the table.
    expect(controls.className).toContain("pointer-events-none");
    expect(controls.className).toContain("group-hover/table:opacity-100");
    expect(screen.getByTestId("markdown-table-controls").closest("[data-markdown-table]")).not.toHaveAttribute(
      "data-controls-shown",
    );
  });

  it("show after a tap on the table and hide when a press lands outside it", () => {
    render(
      <div>
        <MarkdownContent text={TABLE} />
        <p>Elsewhere</p>
      </div>,
    );
    const table = screen.getByRole("table").closest("[data-markdown-table]")!;
    fingerTap(screen.getByText("SWE"));
    expect(table).toHaveAttribute("data-controls-shown");
    // Tapping a button keeps them shown while it acts.
    fingerTap(screen.getByRole("button", { name: "View table" }));
    expect(screen.getByTestId("markdown-table-dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(table).toHaveAttribute("data-controls-shown");

    fireEvent.pointerDown(screen.getByText("Elsewhere"), { pointerType: "touch" });
    expect(table).not.toHaveAttribute("data-controls-shown");
  });

  it("leave a mouse press to hover, so clicking a table doesn't pin them", () => {
    render(<MarkdownContent text={TABLE} />);
    fireEvent.pointerDown(screen.getByText("SWE"), { pointerType: "mouse" });
    expect(screen.getByRole("table").closest("[data-markdown-table]")).not.toHaveAttribute("data-controls-shown");
  });
});
