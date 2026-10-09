// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("../api.js", () => ({
  api: {
    getSessionNotifications: vi.fn().mockResolvedValue([]),
    fetchNotificationContext: vi.fn().mockResolvedValue(null),
  },
}));

import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { SidebarShortcutTiles } from "./SidebarShortcutTiles.js";

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

describe("SidebarShortcutTiles", () => {
  // These tiles replace the phone top bar's Needs input, Notify Me, Quests and
  // Search buttons, so each must stay reachable and close the panel it lives in.
  it("shows the moved actions with their counts", () => {
    render(<SidebarShortcutTiles />);
    expect(
      screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }),
    ).toHaveTextContent("1Needs input");
    expect(screen.getByRole("button", { name: /^Notify Me: 0 tasks/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quests" })).toHaveTextContent("2Quests");
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("closes the panel before opening Needs input, Quests or Search", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarShortcutTiles onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(screen.getByRole("dialog", { name: "Global needs-input notifications" })).toBeInTheDocument();

    useStore.setState({ sidebarOpen: true });
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(window.location.hash).toBe("#/questmaster");

    useStore.setState({ sidebarOpen: true });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
  });
});
