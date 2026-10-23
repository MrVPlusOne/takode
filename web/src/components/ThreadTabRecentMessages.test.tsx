// @vitest-environment jsdom
/**
 * Find's Messages mode: the user's latest messages to a leader with the tab each belongs to,
 * searching them newest first, opening a tab at the chosen message, and Find reopening in
 * the mode the user last chose.
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
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function findMode(scope: HTMLElement, mode: "messages" | "tabs"): HTMLElement {
  return within(scope)
    .getAllByTestId("thread-find-mode")
    .find((item) => item.dataset.mode === mode)!;
}

/** One page holding every given message, with no older page after it. */
function page(results: MessageSearchResult[], nextOffset: number | null = null) {
  return { results, nextOffset };
}

function openRecent(load = vi.fn(async (_query: string, _offset: number, _signal: AbortSignal) => page(RECENT))) {
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
  fireEvent.click(findMode(sheet, "messages"));
  return { sheet, load, onOpenMessage };
}

describe("Find's Messages mode", () => {
  it("lists the user's messages newest first with their tab, state and time, and opens one", async () => {
    // Each row names the tab its message is in, open or closed, so the user can find a
    // conversation without remembering which status group its tab sits in now.
    const { sheet, load, onOpenMessage } = openRecent();
    const rows = await within(sheet).findAllByTestId("thread-tab-recent-row");
    expect(load).toHaveBeenCalledWith("", 0, expect.any(AbortSignal));
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
    const load = vi.fn(async (query: string, _offset: number, _signal: AbortSignal) =>
      page(query ? [message("m1", "q-10", "Try the proxy with a longer timeout", NOW)] : RECENT),
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

  it("loads older pages as the list's end scrolls into view, without repeating messages", async () => {
    // The first page is the newest 2; reaching the end loads the next page from where the
    // server said it starts. A message sent meanwhile pushes m2 onto the next page as well,
    // and it is listed only once.
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const older = message("m0", "q-10", "The very first message", NOW - 9_000_000);
    const load = vi.fn(async (_query: string, offset: number, _signal: AbortSignal) =>
      offset === 0 ? page(RECENT.slice(0, 2), 2) : page([RECENT[1]!, RECENT[2]!, older]),
    );
    const { sheet } = openRecent(load);
    await within(sheet).findAllByTestId("thread-tab-recent-row");
    expect(within(sheet).getByTestId("thread-tab-recent-more").textContent).toBe("Loading older messages…");

    act(() => observers.at(-1)!([{ isIntersecting: true }]));
    await waitFor(() =>
      expect(
        within(sheet)
          .getAllByTestId("thread-tab-recent-row")
          .map((row) => row.dataset.messageId),
      ).toEqual(["m3", "m2", "m1", "m0"]),
    );
    expect(load.mock.calls.map(([query, offset]) => [query, offset])).toEqual([
      ["", 0],
      ["", 2],
    ]);
    // The session's first message is listed: nothing older to load.
    expect(within(sheet).queryByTestId("thread-tab-recent-more")).toBeNull();
  });

  it("offers a retry when an older page fails to load", async () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const load = vi.fn(async (_query: string, offset: number, _signal: AbortSignal) => {
      if (offset === 0) return page(RECENT.slice(0, 1), 1);
      if (fail) throw new Error("offline");
      return page(RECENT.slice(1));
    });
    const { sheet } = openRecent(load);
    await within(sheet).findAllByTestId("thread-tab-recent-row");
    act(() => observers.at(-1)!([{ isIntersecting: true }]));
    const retry = await within(sheet).findByRole("button", { name: "Couldn't load older messages. Try again" });
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(within(sheet).getAllByTestId("thread-tab-recent-row")).toHaveLength(3));
  });

  it("says so when nothing matches", async () => {
    const { sheet } = openRecent(vi.fn(async () => page([])));
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
    expect(screen.queryByTestId("thread-find-mode")).toBeNull();
    expect(screen.getByTestId("thread-tab-switcher").dataset.mode).toBe("tabs");
  });

  it("opens Find in the mode the user chose last", async () => {
    // First use lists tabs; after the user picks Messages, Find opens there next time,
    // and switching back to Tabs is remembered too.
    const { sheet } = openRecent();
    expect(sheet.dataset.mode).toBe("messages");
    await within(sheet).findAllByTestId("thread-tab-recent-row");
    fireEvent.click(screen.getByTestId("thread-tab-switcher-backdrop"));

    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    const reopened = screen.getByTestId("thread-tab-switcher");
    expect(reopened.dataset.mode).toBe("messages");
    expect(findMode(reopened, "messages").getAttribute("aria-checked")).toBe("true");
    await within(reopened).findAllByTestId("thread-tab-recent-row");

    fireEvent.click(findMode(reopened, "tabs"));
    fireEvent.click(screen.getByTestId("thread-tab-switcher-backdrop"));
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    expect(screen.getByTestId("thread-tab-switcher").dataset.mode).toBe("tabs");
  });

  it("starts in Tabs mode the first time", () => {
    render(
      <ThreadTabGroupBar
        main={MAIN}
        tabs={OPEN}
        currentThreadKey="q-10"
        activeOutputThreadKey={null}
        onSelect={vi.fn()}
        loadRecentMessages={vi.fn(async () => page(RECENT))}
        onOpenMessage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    expect(screen.getByTestId("thread-tab-switcher").dataset.mode).toBe("tabs");
  });
});

describe("ThreadTabRail Messages", () => {
  it("asks the server for the user's own messages across the leader's tabs and opens the tab at one", async () => {
    // The rail reuses the leader's message search, limited to the user's messages, in the
    // server's one search order (no separate sort mode), and opens the result through a
    // message route, which also reopens a closed tab.
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({ results: [message("m3", "q-9", "Make the done color quieter", NOW)], nextOffset: null }),
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
    fireEvent.click(findMode(screen.getByTestId("thread-tab-switcher"), "messages"));
    const row = await screen.findByTestId("thread-tab-recent-row");
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost");
    expect(url.pathname).toBe("/api/sessions/leader-session/message-search");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: "leader_all_tabs",
      includeUser: "true",
      includeAssistant: "false",
      includeEvents: "false",
      limit: "50",
      offset: "0",
    });
    expect(url.searchParams.has("sort")).toBe(false);
    fireEvent.click(row);
    expect(window.location.hash).toContain("/msg/m3");
    expect(window.location.hash).toContain("thread=q-9");
  });
});
