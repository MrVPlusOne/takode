// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("../api.js", () => ({
  api: {
    markSessionRead: vi.fn().mockResolvedValue({}),
    getQuestTitles: vi.fn().mockResolvedValue({ quests: [], missingQuestIds: [] }),
  },
}));

import { api } from "../api.js";
import { useStore } from "../store.js";
import { recordViewedTab, resetViewHistoryForTest } from "../utils/view-history.js";
import { NavigationButtons } from "./NavigationButtons.js";

/** A stand-in for the browser's Navigation API, which jsdom lacks. */
class FakeNavigation extends EventTarget {
  canGoBack = false;
  canGoForward = false;
  move(canGoBack: boolean, canGoForward: boolean) {
    this.canGoBack = canGoBack;
    this.canGoForward = canGoForward;
    this.dispatchEvent(new Event("currententrychange"));
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  resetViewHistoryForTest();
  window.location.hash = "";
  useStore.setState({
    sdkSessions: [
      { sessionId: "leader", state: "connected", cwd: "/repo", createdAt: 1, sessionNum: 7, name: "Leader" },
      { sessionId: "worker", state: "connected", cwd: "/repo", createdAt: 2, sessionNum: 9, name: "Fix the tabs" },
    ],
    questTitlePreviews: new Map([["q-12", { questId: "q-12", title: "Make tabs faster", version: 1 }]]),
  } as never);
});

describe("NavigationButtons", () => {
  // Back and Forward follow the browser's own history: each is disabled when the Navigation
  // API says there is no step in that direction, and they update as the user moves.
  it("enables back and forward from the browser's history position", () => {
    const navigation = new FakeNavigation();
    vi.stubGlobal("navigation", navigation);
    render(<NavigationButtons />);

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    act(() => navigation.move(true, false));
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  // Browsers without the Navigation API cannot say where in history they are, so both
  // buttons stay usable rather than being stuck disabled.
  it("keeps both buttons enabled without the Navigation API", () => {
    render(<NavigationButtons />);
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
  });

  // The history button toggles the Recently viewed list: tabs newest first with the tab on
  // screen marked Current, quest tabs titled by their quest, and sessions deleted since left out.
  it("lists recently viewed tabs newest first", () => {
    recordViewedTab("worker", null, Date.now() - 120_000);
    recordViewedTab("gone", null, Date.now() - 90_000);
    recordViewedTab("leader", "q-12", Date.now() - 60_000);
    recordViewedTab("leader", "main", Date.now());
    render(<NavigationButtons />);

    const toggle = screen.getByRole("button", { name: "Recently viewed" });
    fireEvent.click(toggle);
    const panel = screen.getByRole("dialog", { name: "Recently viewed" });
    const rows = within(panel).getAllByTestId("navigation-history-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "MainCurrent#7 Leader",
      "Make tabs faster1m agoq-12 · #7 Leader",
      "Fix the tabs2m ago#9",
    ]);
    expect(rows[0]).toHaveAttribute("aria-current", "page");

    fireEvent.click(toggle);
    expect(screen.queryByRole("dialog", { name: "Recently viewed" })).not.toBeInTheDocument();
  });

  // Choosing a row opens that tab: a leader tab through an explicit thread route (so Main is
  // not replaced by the leader's saved tab), and a plain session like a sidebar choice.
  it("opens the chosen tab and closes the list", () => {
    recordViewedTab("worker", null, 1);
    recordViewedTab("leader", "main", 2);
    recordViewedTab("leader", "q-12", 3);
    render(<NavigationButtons />);

    fireEvent.click(screen.getByRole("button", { name: "Recently viewed" }));
    fireEvent.click(screen.getByRole("button", { name: /^Main/ }));
    expect(window.location.hash).toBe("#/session/7?thread=main");
    expect(screen.queryByRole("dialog", { name: "Recently viewed" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recently viewed" }));
    fireEvent.click(screen.getByRole("button", { name: /^Fix the tabs/ }));
    expect(window.location.hash).toBe("#/session/worker");
    expect(api.markSessionRead).toHaveBeenCalledWith("worker", { mode: "session-view" });
  });
});
