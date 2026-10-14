// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SettingsServerChanges } from "./SettingsServerChanges.js";

const HOUR = 60 * 60 * 1000;

function change(sha: string, subject: string, hoursAgo: number, questId: string | null) {
  return { sha: sha.repeat(40), subject, committedAt: Date.now() - hoursAgo * HOUR, questId };
}

describe("SettingsServerChanges", () => {
  it("shows the incoming changes collapsed, then lists them newest first with their quests", () => {
    render(
      <SettingsServerChanges
        changes={{
          incoming: {
            changes: [change("b", "feat: newer landing", 1, "q-12"), change("a", "fix: older landing", 3, null)],
            // The server lists only the newest commits of a long range, with the full count.
            total: 5,
          },
          currentBuild: null,
        }}
      />,
    );

    const row = screen.getByTestId("server-incoming-changes");
    const toggle = within(row).getByRole("button", { name: /5 new changes/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(row).queryByText("feat: newer landing")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const items = within(row).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("feat: newer landing"),
      expect.stringContaining("fix: older landing"),
      "and 3 older changes",
    ]);
    // A change with a known quest links to it; the time and short commit follow.
    expect(within(items[0]).getByText("q-12").closest("a")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("1h ago");
    expect(items[0]).toHaveTextContent("bbbbbbbb");
    expect(within(items[1]).queryByText(/^q-/)).not.toBeInTheDocument();
  });

  it("shows nothing extra when up to date, and the current build's changes when the previous build is known", () => {
    render(
      <SettingsServerChanges
        changes={{
          incoming: { changes: [], total: 0 },
          currentBuild: {
            commit: "c".repeat(40),
            replacedAt: Date.now() - 2 * HOUR,
            changes: [change("d", "feat: brought in by the restart", 2, "q-7")],
            total: 1,
          },
        }}
      />,
    );

    expect(screen.queryByTestId("server-incoming-changes")).not.toBeInTheDocument();
    const row = screen.getByTestId("server-current-build-changes");
    expect(row).toHaveTextContent("Changes in the current build (1)");
    expect(row).toHaveTextContent("Since cccccccc, loaded 2h ago");
    fireEvent.click(within(row).getByRole("button"));
    expect(within(row).getByText("feat: brought in by the restart")).toBeInTheDocument();
    expect(within(row).getByText("q-7")).toBeInTheDocument();
  });
});
