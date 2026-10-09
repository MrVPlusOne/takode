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

const NEEDS_INPUT = "1 unresolved needs-input notification across sessions";

describe("SidebarQuickActions", () => {
  // The session top bar no longer carries Needs input, Notify Me, Search or Quests on
  // desktop or phone, so the sessions panel must keep each one reachable with its count.
  it("shows the search field and the moved counters", () => {
    render(<SidebarQuickActions closePanelOnOpen={false} />);
    expect(screen.getByRole("button", { name: "Universal Search" })).toHaveTextContent("Search everything…");
    expect(screen.getByRole("button", { name: NEEDS_INPUT })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Notify Me: 0 tasks/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quests (2 active)" })).toHaveTextContent("Quests 2");
  });

  it("keeps the inline desktop panel open when an action opens its view", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarQuickActions closePanelOnOpen={false} onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: NEEDS_INPUT }));
    expect(screen.getByRole("dialog", { name: "Global needs-input notifications" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it("closes the phone panel before opening Needs input, Quests or Search", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarQuickActions closePanelOnOpen onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: NEEDS_INPUT }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(screen.getByRole("dialog", { name: "Global needs-input notifications" })).toBeInTheDocument();

    useStore.setState({ sidebarOpen: true });
    fireEvent.click(screen.getByRole("button", { name: "Quests (2 active)" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(window.location.hash).toBe("#/questmaster");

    useStore.setState({ sidebarOpen: true });
    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
  });
});
