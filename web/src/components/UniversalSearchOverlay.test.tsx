// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";

const mockListQuestPage = vi.fn();
const mockSearchSessionMessages = vi.fn();
const mockClipboardWriteText = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listQuestPage: (...args: unknown[]) => mockListQuestPage(...args),
    searchSessionMessages: (...args: unknown[]) => mockSearchSessionMessages(...args),
  },
}));

import { UniversalSearchOverlay } from "./UniversalSearchOverlay.js";
import { useStore } from "../store.js";
import type { MessageSearchResponse, MessageSearchResult } from "../api.js";
import type { ChatMessage, QuestmasterTask, SdkSessionInfo } from "../types.js";

const now = 1778274000000;
type OverlayProps = ComponentProps<typeof UniversalSearchOverlay>;
type OnCloseMock = ReturnType<typeof vi.fn<OverlayProps["onClose"]>>;
type OnOpenQuestMock = ReturnType<typeof vi.fn<OverlayProps["onOpenQuest"]>>;
type OnOpenMessageMock = ReturnType<typeof vi.fn<OverlayProps["onOpenMessage"]>>;

const sessions: SdkSessionInfo[] = [
  {
    sessionId: "s-new",
    sessionNum: 11,
    state: "connected",
    cwd: "/repo/new",
    createdAt: now - 2_000,
    lastActivityAt: now - 1_000,
    name: "New session",
    backendType: "codex",
  },
  {
    sessionId: "s-old",
    sessionNum: 12,
    state: "connected",
    cwd: "/repo/old",
    createdAt: now - 10_000,
    lastActivityAt: now - 8_000,
    name: "Old session",
    backendType: "claude",
  },
];

const messages: ChatMessage[] = [
  {
    id: "user-old",
    role: "user",
    content: "Older user request about search controls",
    timestamp: now - 30_000,
  },
  {
    id: "assistant-new",
    role: "assistant",
    content: "Assistant note about the search overlay",
    timestamp: now - 20_000,
  },
  {
    id: "user-new",
    role: "user",
    content: "Recent user request about universal search",
    timestamp: now - 10_000,
  },
];

const threadScopedMessages: ChatMessage[] = [
  {
    id: "main-visible",
    role: "user",
    content: "Visible main request about apples",
    timestamp: now - 40_000,
  },
  {
    id: "quest-hidden-new",
    role: "user",
    content: "Hidden quest dragonfruit request",
    timestamp: now - 10_000,
    metadata: {
      threadKey: "q-1272",
      questId: "q-1272",
    },
  },
  {
    id: "quest-ref-hidden",
    role: "user",
    content: "Hidden quest reference with banana",
    timestamp: now - 20_000,
    metadata: {
      threadRefs: [{ threadKey: "q-1272", questId: "q-1272", source: "explicit" }],
    },
  },
  {
    id: "quest-visible",
    role: "user",
    content: "Quest thread-specific request about pears",
    timestamp: now - 30_000,
    metadata: {
      threadKey: "q-1272",
      questId: "q-1272",
    },
  },
  {
    id: "other-quest-hidden",
    role: "user",
    content: "Other quest thread-specific request about pears",
    timestamp: now - 5_000,
    metadata: {
      threadKey: "q-999",
      questId: "q-999",
    },
  },
];

function messageResult(overrides: Partial<MessageSearchResult>): MessageSearchResult {
  const messageId = overrides.messageId ?? "message-1";
  return {
    id: `s-new:0:${messageId}`,
    sessionId: "s-new",
    sessionNum: 11,
    messageId,
    historyIndex: 0,
    role: "user",
    category: "user",
    timestamp: now - 10_000,
    snippet: "Recent user request about universal search",
    routeThreadKey: "main",
    sourceThreadKey: "main",
    sourceLabel: "Main",
    ...overrides,
  };
}

function messageSearchResponse(
  results: MessageSearchResult[],
  overrides: Partial<MessageSearchResponse> = {},
): MessageSearchResponse {
  return {
    sessionId: "s-new",
    sessionNum: 11,
    query: "",
    scope: { kind: "current_thread", threadKey: "main", label: "Searching in #11 Main" },
    filters: { user: true, assistant: false, event: false },
    totalMatches: results.length,
    results,
    nextOffset: null,
    hasMore: false,
    tookMs: 1,
    ...overrides,
  };
}

function quest(overrides: Partial<QuestmasterTask> & Pick<QuestmasterTask, "questId" | "title">): QuestmasterTask {
  return {
    status: "in_progress",
    createdAt: now - 60_000,
    statusChangedAt: now - 20_000,
    tags: [],
    ...overrides,
  } as QuestmasterTask;
}

function mockQuestResults(quests: QuestmasterTask[]) {
  mockListQuestPage.mockResolvedValueOnce({
    quests,
    total: quests.length,
    offset: 0,
    limit: 20,
    hasMore: false,
    nextOffset: null,
    previousOffset: null,
    counts: {
      all: quests.length,
      idea: quests.filter((item) => item.status === "idea").length,
      refined: quests.filter((item) => item.status === "refined").length,
      in_progress: quests.filter((item) => item.status === "in_progress").length,
      done: quests.filter((item) => item.status === "done").length,
    },
    allTags: [],
  });
}

function renderOverlay(
  props: Partial<ComponentProps<typeof UniversalSearchOverlay>> = {},
  callbacks: {
    onOpenQuest?: OnOpenQuestMock;
    onOpenMessage?: OnOpenMessageMock;
    onClose?: OnCloseMock;
  } = {},
) {
  const onClose = callbacks.onClose ?? vi.fn<OverlayProps["onClose"]>(() => undefined);
  const onOpenQuest = callbacks.onOpenQuest ?? vi.fn<OverlayProps["onOpenQuest"]>(() => undefined);
  const onOpenMessage = callbacks.onOpenMessage ?? vi.fn<OverlayProps["onOpenMessage"]>(() => undefined);
  const view = render(
    <UniversalSearchOverlay
      open
      currentSessionId="s-new"
      currentThreadKey="main"
      sessions={sessions}
      messages={messages}
      onClose={onClose}
      onOpenQuest={onOpenQuest}
      onOpenMessage={onOpenMessage}
      {...props}
    />,
  );
  return { ...view, onClose, onOpenQuest, onOpenMessage };
}

async function advanceSearchDebounce() {
  await new Promise((resolve) => window.setTimeout(resolve, 330));
}

describe("UniversalSearchOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "";
    mockListQuestPage.mockClear();
    mockSearchSessionMessages.mockClear();
    mockClipboardWriteText.mockReset();
    mockClipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
    useStore.getState().setQuests([]);
    useStore.getState().setSdkSessions(sessions);
    mockListQuestPage.mockResolvedValue({
      quests: [],
      total: 0,
      offset: 0,
      limit: 20,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      counts: { all: 0, idea: 0, refined: 0, in_progress: 0, done: 0 },
      allTags: [],
    });
    mockSearchSessionMessages.mockResolvedValue(
      messageSearchResponse([
        messageResult({ messageId: "user-new", timestamp: now - 10_000 }),
        messageResult({
          messageId: "user-old",
          timestamp: now - 30_000,
          snippet: "Older user request about search controls",
        }),
      ]),
    );
  });

  afterEach(() => {
    useStore.getState().setQuests([]);
    useStore.getState().setSdkSessions([]);
    vi.restoreAllMocks();
  });

  it("focuses the search input when opened", async () => {
    renderOverlay();

    const input = screen.getByRole("searchbox");
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("restores a persisted query when opened", () => {
    // Query text is browser-owned UI state, so a fresh overlay mount should hydrate it from localStorage.
    localStorage.setItem("cc-universal-search-query", "universal search state");

    renderOverlay();

    expect(screen.getByRole("searchbox")).toHaveValue("universal search state");
  });

  it("persists query updates and restores them across close/open cycles", () => {
    // Closing the overlay should not discard the user's last typed query.
    const { rerender, onClose, onOpenMessage, onOpenQuest } = renderOverlay();
    const input = screen.getByRole("searchbox");

    fireEvent.change(input, { target: { value: "persist me" } });

    expect(localStorage.getItem("cc-universal-search-query")).toBe("persist me");

    rerender(
      <UniversalSearchOverlay
        open={false}
        currentSessionId="s-new"
        currentThreadKey="main"
        sessions={sessions}
        messages={messages}
        onClose={onClose}
        onOpenQuest={onOpenQuest}
        onOpenMessage={onOpenMessage}
      />,
    );
    rerender(
      <UniversalSearchOverlay
        open
        currentSessionId="s-new"
        currentThreadKey="main"
        sessions={sessions}
        messages={messages}
        onClose={onClose}
        onOpenQuest={onOpenQuest}
        onOpenMessage={onOpenMessage}
      />,
    );

    expect(screen.getByRole("searchbox")).toHaveValue("persist me");
  });

  it("persists clearing the query as an empty value", () => {
    // Clearing must update storage too; otherwise the next open would resurrect a stale query.
    localStorage.setItem("cc-universal-search-query", "to clear");
    renderOverlay();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });

    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(localStorage.getItem("cc-universal-search-query")).toBe("");
  });

  it("keeps persisted queries isolated by server id", () => {
    // Universal Search query persistence is local UI state, but it still must respect server-scoped storage.
    localStorage.setItem("cc-server-id", "server-a");
    localStorage.setItem("server-a:cc-universal-search-query", "alpha");
    localStorage.setItem("server-b:cc-universal-search-query", "beta");

    const first = renderOverlay();

    expect(screen.getByRole("searchbox")).toHaveValue("alpha");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alpha updated" } });
    expect(localStorage.getItem("server-a:cc-universal-search-query")).toBe("alpha updated");
    expect(localStorage.getItem("server-b:cc-universal-search-query")).toBe("beta");

    first.unmount();
    localStorage.setItem("cc-server-id", "server-b");

    renderOverlay();

    expect(screen.getByRole("searchbox")).toHaveValue("beta");
    expect(localStorage.getItem("server-a:cc-universal-search-query")).toBe("alpha updated");
  });

  it("defaults to current-session message mode and lists recent user messages for an empty query", async () => {
    renderOverlay();

    expect(await screen.findByText("Recent user request about universal search")).toBeInTheDocument();
    expect(screen.getByText("Older user request about search controls")).toBeInTheDocument();
    expect(screen.queryByText("Assistant note about the search overlay")).not.toBeInTheDocument();
    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalled());
    expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
      "s-new",
      expect.objectContaining({
        query: "",
        scope: "session",
        threadKey: undefined,
        filters: { user: true, assistant: false, event: false },
        limit: 20,
      }),
    );
    expect(mockListQuestPage).not.toHaveBeenCalled();
  });

  it("keeps Message mode disabled and falls back to Quest mode when there is no current session context", async () => {
    renderOverlay({ currentSessionId: null, messages: [] });

    expect(screen.queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Messages" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(mockListQuestPage).toHaveBeenCalled());
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
  });

  it("falls back from a persisted legacy Session mode to an available mode", async () => {
    localStorage.setItem("cc-universal-search-mode", "sessions");
    renderOverlay({ currentSessionId: null, currentThreadKey: null, messages: [] });

    expect(screen.queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(mockListQuestPage).toHaveBeenCalled());
  });

  it("searches whole-session Message mode for normal sessions without a thread route", async () => {
    renderOverlay({ currentThreadKey: null });

    expect(screen.getByRole("button", { name: "Messages" })).toBeEnabled();
    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalled());
    expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
      "s-new",
      expect.objectContaining({ scope: "session", threadKey: undefined }),
    );
  });

  it("uses backend Message search for thread scope and renders matched snippets with highlighting", async () => {
    const questResponse = messageSearchResponse(
      [
        messageResult({
          messageId: "quest-visible",
          snippet: "Quest thread-specific request about pears",
          sourceThreadKey: "q-1272",
          sourceLabel: "Thread q-1272",
          routeThreadKey: "q-1272",
        }),
      ],
      { scope: { kind: "current_thread", threadKey: "q-1272", label: "Searching in #11 thread q-1272" } },
    );
    mockSearchSessionMessages.mockResolvedValueOnce(questResponse).mockResolvedValueOnce(questResponse);
    renderOverlay({
      currentThreadKey: "q-1272",
      messages: threadScopedMessages,
      sessions: [{ ...sessions[0]!, isOrchestrator: true }, sessions[1]!],
    });

    expect(await screen.findByText("Searching in #11 thread q-1272")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "thread specific" } });
    await advanceSearchDebounce();

    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({ query: "thread specific", scope: "current_thread", threadKey: "q-1272" }),
      ),
    );
    expect(await screen.findByText("Thread q-1272")).toBeInTheDocument();
    expect(screen.getAllByText("thread").some((element) => element.tagName === "MARK")).toBe(true);
  });

  it("persists Message-mode filters and leader scope settings", async () => {
    const leaderSessions: SdkSessionInfo[] = [{ ...sessions[0]!, isOrchestrator: true }, sessions[1]!];
    renderOverlay({ sessions: leaderSessions });

    expect(await screen.findByText("Searching in #11 Main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Across tabs" }));
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({
          scope: "leader_all_tabs",
          filters: { user: true, assistant: true, event: false },
        }),
      ),
    );

    const stored = JSON.parse(localStorage.getItem("cc-universal-search-message-settings") || "{}");
    expect(stored).toEqual({
      scope: "leader_all_tabs",
      filters: { user: true, assistant: true, event: false },
    });
  });

  it("runs only the selected mode adapter and uses newest-updated quest sorting for empty queries", async () => {
    const recentQuest = quest({
      questId: "q-101",
      title: "Recently updated quest",
      updatedAt: now - 1_000,
      tags: ["search"],
    });
    useStore.getState().setQuests([recentQuest]);
    mockListQuestPage.mockResolvedValueOnce({
      quests: [recentQuest],
      total: 1,
      offset: 0,
      limit: 20,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      counts: { all: 1, idea: 0, refined: 0, in_progress: 1, done: 0 },
      allTags: ["search"],
    });
    renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    await waitFor(() => expect(mockListQuestPage).toHaveBeenCalled());
    expect(mockListQuestPage).toHaveBeenLastCalledWith({
      limit: 20,
      text: undefined,
      sortColumn: "updated",
      sortDirection: "desc",
    });
    expect(await screen.findByText("Recently updated quest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "q-101" })).toBeInTheDocument();
  });

  it("remembers the last selected mode when reopened", async () => {
    const { rerender, onClose, onOpenQuest, onOpenMessage } = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: "Quests" }));
    expect(screen.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-pressed", "true");

    rerender(
      <UniversalSearchOverlay
        open={false}
        currentSessionId="s-new"
        currentThreadKey="main"
        sessions={sessions}
        messages={messages}
        onClose={onClose}
        onOpenQuest={onOpenQuest}
        onOpenMessage={onOpenMessage}
      />,
    );
    rerender(
      <UniversalSearchOverlay
        open
        currentSessionId="s-new"
        currentThreadKey="main"
        sessions={sessions}
        messages={messages}
        onClose={onClose}
        onOpenQuest={onOpenQuest}
        onOpenMessage={onOpenMessage}
      />,
    );

    expect(screen.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(mockListQuestPage).toHaveBeenCalled());
  });

  it("selects the top result for a new query after a lower result was selected", async () => {
    const callbacks = renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });

    await screen.findByText("Recent user request about universal search");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "recent" } });
    await advanceSearchDebounce();
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(callbacks.onOpenMessage).toHaveBeenCalledWith("s-new", "user-new", "main");
  });

  it("does not repeat remote quest searches when unrelated session props refresh", async () => {
    mockListQuestPage.mockResolvedValue({
      quests: [quest({ questId: "q-202", title: "Stable quest result", updatedAt: now - 1_000 })],
      total: 1,
      offset: 0,
      limit: 20,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      counts: { all: 1, idea: 0, refined: 0, in_progress: 1, done: 0 },
      allTags: [],
    });
    const callbacks = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));
    await waitFor(() => expect(mockListQuestPage).toHaveBeenCalledTimes(1));
    mockListQuestPage.mockClear();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "stable" } });
    await advanceSearchDebounce();
    await waitFor(() => expect(mockListQuestPage).toHaveBeenCalledTimes(1));

    callbacks.rerender(
      <UniversalSearchOverlay
        open
        currentSessionId="s-new"
        currentThreadKey="main"
        sessions={[...sessions]}
        messages={messages}
        onClose={callbacks.onClose}
        onOpenQuest={callbacks.onOpenQuest}
        onOpenMessage={callbacks.onOpenMessage}
      />,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mockListQuestPage).toHaveBeenCalledTimes(1);
  });

  it("keeps quest owner links visible and usable above the overlay", async () => {
    const ownedQuest = quest({
      questId: "q-303",
      title: "Owned quest result",
      updatedAt: now - 1_000,
      tags: ["hidden-tag"],
      leaderSessionId: "s-new",
      sessionId: "s-old",
    });
    useStore.getState().setQuests([ownedQuest]);
    mockListQuestPage.mockResolvedValueOnce({
      quests: [ownedQuest],
      total: 1,
      offset: 0,
      limit: 20,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      counts: { all: 1, idea: 0, refined: 0, in_progress: 1, done: 0 },
      allTags: ["hidden-tag"],
    });

    const callbacks = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    const questLink = await screen.findByRole("link", { name: "q-303" });
    expect(questLink).toBeInTheDocument();
    expect(screen.queryByText("#hidden-tag")).not.toBeInTheDocument();
    expect(screen.getByText("leader")).toBeInTheDocument();
    expect(screen.getByText("worker")).toBeInTheDocument();
    const leaderLink = screen.getByRole("link", { name: "#11" });
    expect(leaderLink).toBeInTheDocument();
    const workerLink = screen.getByRole("link", { name: "#12" });
    expect(workerLink).toBeInTheDocument();
    expect(leaderLink.getAttribute("href")).toBe("#/session/11?thread=q-303");
    expect(workerLink.getAttribute("href")).toBe("#/session/12");

    fireEvent.mouseEnter(questLink);
    expect(screen.getByTestId("quest-hover-card")).toHaveClass("z-[90]");
    fireEvent.click(questLink);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseEnter(leaderLink);
    expect(screen.getByTestId("session-hover-card")).toHaveClass("z-[90]");
    fireEvent.click(leaderLink);
    expect(window.location.hash).toBe("#/session/11?thread=q-303");
    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
  });

  it("copies the full quest ID from the Quest result copy button without opening the row", async () => {
    const resultQuest = quest({
      questId: "q-1290",
      title: "Add Quest result actions",
      updatedAt: now - 1_000,
    });
    mockQuestResults([resultQuest]);

    const callbacks = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByRole("link", { name: "q-1290" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy quest ID q-1290" }));

    await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalledWith("q-1290"));
    expect(callbacks.onOpenQuest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Add Quest result actions"));
    expect(callbacks.onOpenQuest).toHaveBeenCalledWith("q-1290", "");
  });

  it("opens a Quest result action submenu from Right with available actions in order", async () => {
    const resultQuest = quest({
      questId: "q-404",
      title: "Quest with sessions",
      updatedAt: now - 1_000,
      leaderSessionId: "s-new",
      sessionId: "s-old",
    });
    mockQuestResults([resultQuest]);

    renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByText("Quest with sessions")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });

    const menu = screen.getByRole("menu", { name: "Actions for q-404" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy quest number", "Go to leader session #11", "Go to worker session #12"]);
  });

  it("omits unavailable session actions and exposes the chevron options hint", async () => {
    const resultQuest = quest({
      questId: "q-405",
      title: "Quest without sessions",
      updatedAt: now - 1_000,
    });
    mockQuestResults([resultQuest]);

    renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByText("Quest without sessions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More options for q-405" }));

    const menu = screen.getByRole("menu", { name: "Actions for q-405" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy quest number"]);
    expect(within(menu).queryByText(/Go to leader session/)).not.toBeInTheDocument();
    expect(within(menu).queryByText(/Go to worker session/)).not.toBeInTheDocument();
  });

  it("dismisses the Quest action submenu with Left and navigates selected submenu actions", async () => {
    const resultQuest = quest({
      questId: "q-406",
      title: "Quest navigation actions",
      updatedAt: now - 1_000,
      leaderSessionId: "s-new",
      sessionId: "s-old",
    });
    mockQuestResults([resultQuest]);

    const callbacks = renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByText("Quest navigation actions")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "Actions for q-406" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Actions for q-406" })).not.toBeInTheDocument();
    expect(callbacks.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(window.location.hash).toBe("#/session/11?thread=q-406");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates the worker submenu action when selected with keyboard arrows", async () => {
    const resultQuest = quest({
      questId: "q-409",
      title: "Quest worker navigation action",
      updatedAt: now - 1_000,
      leaderSessionId: "s-new",
      sessionId: "s-old",
    });
    mockQuestResults([resultQuest]);

    const callbacks = renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByText("Quest worker navigation action")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(window.location.hash).toBe("#/session/s-old");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("activates the Quest action submenu copy item without closing the overlay", async () => {
    const resultQuest = quest({
      questId: "q-407",
      title: "Quest copy action",
      updatedAt: now - 1_000,
    });
    mockQuestResults([resultQuest]);

    const callbacks = renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByText("Quest copy action")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalledWith("q-407"));
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Actions for q-407" })).not.toBeInTheDocument();
  });

  it("preserves Quest result Enter opening when the action submenu is closed", async () => {
    const resultQuest = quest({
      questId: "q-408",
      title: "Quest enter open",
      updatedAt: now - 1_000,
    });
    mockQuestResults([resultQuest]);

    const callbacks = renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByText("Quest enter open")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(callbacks.onOpenQuest).toHaveBeenCalledWith("q-408", "");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores stale Message search responses after the query changes", async () => {
    let resolveOld!: (value: MessageSearchResponse) => void;
    let resolveNew!: (value: MessageSearchResponse) => void;
    mockSearchSessionMessages
      .mockResolvedValueOnce(messageSearchResponse([]))
      .mockImplementationOnce(
        () =>
          new Promise<MessageSearchResponse>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<MessageSearchResponse>((resolve) => {
            resolveNew = resolve;
          }),
      );

    renderOverlay();

    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalledTimes(1));
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "old" } });
    await advanceSearchDebounce();
    fireEvent.change(input, { target: { value: "new" } });
    await advanceSearchDebounce();

    resolveNew(
      messageSearchResponse(
        [messageResult({ messageId: "new-message", snippet: "New message search result", timestamp: now - 1_000 })],
        { query: "new" },
      ),
    );
    await screen.findByText("New");
    expect(screen.getByText("message search result")).toBeInTheDocument();

    resolveOld(
      messageSearchResponse(
        [messageResult({ messageId: "old-message", snippet: "Old message search result", timestamp: now - 2_000 })],
        { query: "old" },
      ),
    );
    await waitFor(() => expect(screen.queryByText("Old")).not.toBeInTheDocument());
  });

  it("supports Tab mode cycling, arrow selection, Enter opening, and Escape closing", async () => {
    const callbacks = renderOverlay();
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });

    await screen.findByText("Recent user request about universal search");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(callbacks.onOpenMessage).toHaveBeenCalledWith("s-new", "user-old", "main");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);

    callbacks.onClose.mockClear();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});
