// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { QuestClaimBlock } from "./QuestClaimBlock.js";

describe("QuestClaimBlock", () => {
  it("uses shared quest status colors for the status badge", () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-77",
          title: "Palette test",
          status: "in_progress",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    const inProgressBadge = screen.getByText("In Progress");
    expect(inProgressBadge).toHaveClass("text-green-400");
  });

  it("opens local details modal and keeps quest link scoped to the same id", () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-76",
          title: "Dummy quest",
          status: "in_progress",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    const dialog = screen.getByRole("dialog", { name: /Quest details: Dummy quest/i });
    expect(dialog).toBeInTheDocument();
    const viewLink = within(dialog).getByRole("link", { name: "Open in Questmaster" });
    expect(viewLink).toHaveAttribute("href", "#/questmaster?quest=q-76");
  });
});
