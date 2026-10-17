// @vitest-environment jsdom
/**
 * Find's Recent mode: the user's latest messages to a leader with the tab each belongs to,
 * searching them, and opening a tab at the chosen message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MessageSearchResult } from "../api/session-message-search.js";
import { ThreadTabGroupBar } from "./ThreadTabGroups.js";
import { ThreadTabRail, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

function tab(threadKey: string, overrides: Partial<PrimaryThreadChip> = {}): PrimaryThreadChip {
  return {
    threadKey,
    questId: threadKey,
    title: `Quest ${threadKey}`,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 0,
    ...overrides,
  };
}

function message(messageId: string, threadKey: string, snippet: string, timestamp: number): MessageSearchResult {
  return {
    id: `leader:${messageId}`,
    sessionId: "leader",
    sessionNum: 7,
    messageId,
    historyIndex: timestamp,
    role: "user",
    category: "user",
    timestamp,
    snippet,
    routeThreadKey: threadKey,
    sourceThreadKey: threadKey,
    starred: false,
  };
}

const MAIN = tab("main", { questId: undefined, title: "Main Thread" });
const OPEN = [tab("q-10", { title: "Fix the relay proxy", stateLabel: "Work" })];
const CLOSED = [tab("q-9", { title: "Board colors", stateLabel: "Done", completed: true })];
const NOW = Date.now();
const RECENT = [
  message("m3", "q-9", "Make the done color quieter", NOW - 60_000),
  message("m2", "main", "What else is running?", NOW - 120_000),
  message("m1", "q-10", "Try the proxy with a longer timeout", NOW - 180_000),
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function openRecent(load = vi.fn(async (_query: string, _signal: AbortSignal) => RECENT)) {
  const onOpenMessage = vi.fn();
  render(
    <ThreadTabGroupBar
      main={MAIN}
      tabs={OPEN}
      closedTabs={CLOSED}
      currentThreadKey="q-10"
      activeOutputThreadKey={null}
      onSelect={vi.fn()}
      loadRecentMessages={load}
      onOpenMessage={onOpenMessage}
    />,
  );
  fireEvent.click(screen.getByTestId("thread-tab-group-search"));
  const sheet = screen.getByTestId("thread-tab-switcher");
  const chip = within(sheet)
    .getAllByTestId("thread-tab-switcher-filter")
    .find((item) => item.dataset.filter === "recent")!;
  fireEvent.click(chip);
  return { sheet, load, onOpenMessage };
}

describe("Find's Recent mode", () => {
  it("lists the user's messages newest first with their tab, state and time, and opens one", async () => {
    // Each row names the tab its message is in, open or closed, so the user can find a
    // conversation without remembering which status group its tab sits in now.
    const { sheet, load, onOpenMessage } = openRecent();
    const rows = await within(sheet).findAllByTestId("thread-tab-recent-row");
    expect(load).toHaveBeenCalledWith("", expect.any(AbortSignal));
    expect(rows.map((row) => row.dataset.messageId)).toEqual(["m3", "m2", "m1"]);
    expect(rows[0]!.textContent).toContain("Make the done color quieter");
    expect(rows[0]!.textContent).toContain("Board colors · Done · 1m ago");
    expect(rows[1]!.textContent).toContain("Main · 2m ago");
    expect(rows[2]!.textContent).toContain("Fix the relay proxy · Work");
    // Tabs are not listed in this mode.
    expect(within(sheet).queryByTestId("thread-tab-list-row")).toBeNull();

    fireEvent.click(rows[0]!);
    expect(onOpenMessage).toHaveBeenCalledWith("q-9", "m3");
    expect(screen.queryByTestId("thread-tab-switcher")).toBeNull();
  });

  it("searches the user's messages after a short pause in typing", async () => {
    const load = vi.fn(async (query: string, _signal: AbortSignal) =>
      query ? [message("m1", "q-10", "Try the proxy with a longer timeout", NOW)] : RECENT,
    );
    const { sheet } = openRecent(load);
    await within(sheet).findAllByTestId("thread-tab-recent-row");
    vi.useFakeTimers();
    const input = within(sheet).getByTestId("thread-tab-switcher-search");
    expect(input.getAttribute("placeholder")).toBe("Search your messages");
    fireEvent.change(input, { target: { value: "prox" } });
    fireEvent.change(input, { target: { value: "proxy" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    vi.useRealTimers();
    // Only the settled query is searched, not every keystroke.
    expect(load.mock.calls.map(([query]) => query)).toEqual(["", "proxy"]);
    await waitFor(() =>
      expect(
        within(sheet)
          .getAllByTestId("thread-tab-recent-row")
          .map((row) => row.dataset.messageId),
      ).toEqual(["m1"]),
    );
  });

  it("says so when nothing matches", async () => {
    const { sheet } = openRecent(vi.fn(async () => []));
    await waitFor(() =>
      expect(within(sheet).getByTestId("thread-tab-recent-status").textContent).toBe("No messages to this leader yet."),
    );
  });

  it("is offered only when the bar can load and open messages", () => {
    render(
      <ThreadTabGroupBar
        main={MAIN}
        tabs={OPEN}
        currentThreadKey="q-10"
        activeOutputThreadKey={null}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    const filters = screen.getAllByTestId("thread-tab-switcher-filter").map((chip) => chip.dataset.filter);
    expect(filters).not.toContain("recent");
  });
});

describe("ThreadTabRail Recent", () => {
  it("asks the server for the user's own messages across the leader's tabs and opens the tab at one", async () => {
    // The rail reuses the leader's message search, limited to the user's messages, and
    // opens the result through a message route, which also reopens a closed tab.
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({ results: [message("m3", "q-9", "Make the done color quieter", NOW)] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ThreadTabRail
        mainState={MAIN}
        tabs={OPEN}
        closedTabs={CLOSED}
        sessionId="leader-session"
        currentThreadKey="q-10"
        onSelectThread={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    fireEvent.click(
      screen.getAllByTestId("thread-tab-switcher-filter").find((chip) => chip.dataset.filter === "recent")!,
    );
    const row = await screen.findByTestId("thread-tab-recent-row");
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost");
    expect(url.pathname).toBe("/api/sessions/leader-session/message-search");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: "leader_all_tabs",
      includeUser: "true",
      includeAssistant: "false",
      includeEvents: "false",
      limit: "50",
    });
    fireEvent.click(row);
    expect(window.location.hash).toContain("/msg/m3");
    expect(window.location.hash).toContain("thread=q-9");
  });
});
