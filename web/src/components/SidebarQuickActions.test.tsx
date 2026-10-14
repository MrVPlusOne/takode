// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { SidebarQuickActions } from "./SidebarQuickActions.js";

beforeEach(() => {
  window.location.hash = "";
  useStore.setState({
    sidebarOpen: true,
    questSummary: null,
    quests: [{ status: "in_progress" }, { status: "done" }, { status: "refined" }] as QuestmasterTask[],
    sdkSessions: [{ sessionId: "s1", state: "connected", cwd: "/repo", createdAt: 1, sessionNum: 7, name: "Worker" }],
    sessionNotifications: new Map([
      [
        "s1",
        [{ id: "n1", category: "needs-input", summary: "Pick a layout", timestamp: 1, messageId: "m1", done: false }],
      ],
    ]),
  });
});

describe("SidebarQuickActions", () => {
  // Search and Quests share one row. The needs-input and Notify Me counts are gone,
  // even with a prompt waiting, because the top bar's attention list covers them.
  it("shows search and Quests on one row without the attention counts", () => {
    render(<SidebarQuickActions closePanelOnOpen={false} />);
    const search = screen.getByRole("button", { name: "Universal Search" });
    expect(search).toHaveTextContent("Search…");
    expect(screen.getByRole("button", { name: "Quests (2 active)" })).toHaveTextContent("Quests 2");
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /needs-input/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Notify Me/ })).not.toBeInTheDocument();
  });

  // The visible shortcut hint did not fit beside Quests; the tooltip keeps it discoverable.
  it("names the search shortcut in the tooltip", () => {
    useStore.setState({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });
    render(<SidebarQuickActions closePanelOnOpen={false} />);
    expect(screen.getByRole("button", { name: "Universal Search" }).title).toMatch(/^Search everything \(.+F\)$/);
  });

  it("keeps the inline desktop panel open when an action opens its view", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarQuickActions closePanelOnOpen={false} onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it("closes the phone panel before opening Quests or Search", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarQuickActions closePanelOnOpen onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "Quests (2 active)" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(window.location.hash).toBe("#/questmaster");

    useStore.setState({ sidebarOpen: true });
    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
  });
});
