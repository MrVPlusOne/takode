// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useState, type ComponentProps } from "react";

const mockListQuestPage = vi.fn();
const mockSearchSessionMessages = vi.fn();
const mockSearchGlobalStarredMessages = vi.fn();
const mockFetchRecentAskBundles = vi.fn();
const mockFetchMessagePreview = vi.fn();
const mockGetQuestValidated = vi.fn();
const mockClipboardWriteText = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listQuestPage: (...args: unknown[]) => mockListQuestPage(...args),
    searchSessionMessages: (...args: unknown[]) => mockSearchSessionMessages(...args),
    searchGlobalStarredMessages: (...args: unknown[]) => mockSearchGlobalStarredMessages(...args),
    fetchRecentAskBundles: (...args: unknown[]) => mockFetchRecentAskBundles(...args),
    fetchMessagePreview: (...args: unknown[]) => mockFetchMessagePreview(...args),
    getQuestValidated: (...args: unknown[]) => mockGetQuestValidated(...args),
  },
}));

import { UniversalSearchOverlay } from "./UniversalSearchOverlay.js";
import { useStore } from "../store.js";
import type {
  GlobalStarredMessageSearchResponse,
  GlobalStarredMessageSearchResult,
  MessageSearchResponse,
  MessageSearchResult,
  RecentAskBundlesResponse,
} from "../api.js";
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
    starred: false,
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
    filters: { user: true, assistant: false, event: false, starredOnly: false },
    totalMatches: results.length,
    results,
    nextOffset: null,
    hasMore: false,
    tookMs: 1,
    ...overrides,
  };
}

function starredMessageResult(overrides: Partial<GlobalStarredMessageSearchResult>): GlobalStarredMessageSearchResult {
  const messageId = overrides.messageId ?? "starred-1";
  return {
    id: `s-old:0:${messageId}`,
    sessionId: "s-old",
    sessionNum: 12,
    sessionName: "Old session",
    sessionState: "exited",
    archived: false,
    messageId,
    historyIndex: 0,
    role: "assistant",
    category: "assistant",
    starred: true,
    starredAt: now - 2_000,
    timestamp: now - 10_000,
    snippet: "Starred assistant note about global search",
    routeThreadKey: "main",
    sourceThreadKey: "main",
    sourceLabel: "Main",
    ...overrides,
  };
}

function starredSearchResponse(
  results: GlobalStarredMessageSearchResult[],
  overrides: Partial<GlobalStarredMessageSearchResponse> = {},
): GlobalStarredMessageSearchResponse {
  return {
    query: "",
    totalMatches: results.length,
    results,
    nextOffset: null,
    hasMore: false,
    tookMs: 1,
    ...overrides,
  };
}

function recentAskResponse(overrides: Partial<RecentAskBundlesResponse> = {}): RecentAskBundlesResponse {
  return {
    groups: [
      {
        id: "s-new:u-recent-1",
        sessionId: "s-new",
        sessionNum: 11,
        sessionName: "New session",
        sessionState: "connected",
        archived: false,
        sessionSpaceId: "default",
        sessionSpaceName: "Default",
        ownerThreadKey: "q-1931",
        questId: "q-1931",
        questTitle: "Build global Recent asks modal",
        questStatus: "in_progress",
        firstAskedAt: now - 20_000,
        lastAskedAt: now - 10_000,
        status: "working",
        members: [
          {
            messageId: "u-recent-2",
            historyIndex: 8,
            timestamp: now - 10_000,
            preview: "Keep every correction independently navigable",
            truncated: false,
            imageCount: 1,
          },
        ],
      },
    ],
    totalMatches: 1,
    totalRecentGroups: 1,
    limit: 50,
    query: "",
    filter: "all",
    sessionSpaceId: null,
    attentionCount: 0,
    sessionSpaces: [
      { id: "default", name: "Default", count: 1 },
      { id: "research", name: "Research", count: 2 },
    ],
    coverageNotice: "Some archived sessions are available only through Search.",
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
    mockSearchGlobalStarredMessages.mockClear();
    mockFetchRecentAskBundles.mockClear();
    mockFetchMessagePreview.mockClear();
    mockGetQuestValidated.mockReset();
    mockClipboardWriteText.mockReset();
    mockClipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
    useStore.getState().setQuests([]);
    useStore.getState().setSdkSessions(sessions);
    useStore.setState({ questOverlayId: null, questOverlaySearchHighlight: null });
    mockGetQuestValidated.mockImplementation(async (questId: string, etag?: string | null) => {
      const key = questId.toLowerCase();
      const state = useStore.getState();
      const quest = state.questDetails.get(key) ?? state.quests.find((item) => item.questId.toLowerCase() === key);
      if (!quest) throw new Error("Quest not found");
      return etag ? { status: "not-modified", etag } : { status: "fresh", data: quest, etag: '"test-detail"' };
    });
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
    mockSearchGlobalStarredMessages.mockResolvedValue(starredSearchResponse([]));
    mockFetchRecentAskBundles.mockResolvedValue(recentAskResponse());
    mockFetchMessagePreview.mockResolvedValue(null);
  });

  afterEach(() => {
    useStore.getState().setQuests([]);
    useStore.getState().setSdkSessions([]);
    useStore.setState({ questOverlayId: null, questOverlaySearchHighlight: null });
    vi.restoreAllMocks();
  });

  it("focuses the search input when opened", async () => {
    renderOverlay();

    const input = screen.getByRole("searchbox", { name: "Universal Search query" });
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("uses text search semantics and one conventional close control", () => {
    // A text-backed searchbox avoids WebKit's native blue cancel glyph, leaving the explicit accessible close button as the only dismissal control.
    renderOverlay({ initialQuery: "illustration" });

    const input = screen.getByRole("searchbox", { name: "Universal Search query" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "search");
    expect(screen.getAllByRole("button", { name: "Close Universal Search" })).toHaveLength(1);
  });

  it("returns focus to the element that opened the fixed modal", async () => {
    // Closing by button or Escape unmounts the fixed dialog, so focus must return to the exact trigger rather than falling back to the document body.
    function FocusReturnHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open Universal Search
          </button>
          <UniversalSearchOverlay
            open={open}
            currentSessionId="s-new"
            currentThreadKey="main"
            sessions={sessions}
            messages={messages}
            onClose={() => setOpen(false)}
            onOpenQuest={() => {}}
            onOpenMessage={() => {}}
          />
        </>
      );
    }

    render(<FocusReturnHarness />);
    const trigger = screen.getByRole("button", { name: "Open Universal Search" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Universal Search query" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Close Universal Search" }));
    await waitFor(() => expect(trigger).toHaveFocus());
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

  it("defaults to query-free Recent browsing and announces mode changes politely", async () => {
    renderOverlay();

    const recentButton = screen.getByRole("button", { name: "Recent" });
    expect(recentButton).toHaveAttribute("aria-pressed", "true");
    expect(recentButton).toHaveAttribute("title", "Browse recent conversations");
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      "Browse recent conversations or search this session's messages...",
    );
    expect(await screen.findByText("Keep every correction independently navigable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search this session's messages" })).toBeInTheDocument();
    expect(screen.getByText("Recent mode")).toHaveAttribute("aria-live", "polite");
    await waitFor(() =>
      expect(mockFetchRecentAskBundles).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: "all", sessionSpaceId: null }),
      ),
    );
    expect(mockFetchRecentAskBundles.mock.calls.at(-1)?.[0]).not.toHaveProperty("query");
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
    expect(mockListQuestPage).not.toHaveBeenCalled();
  });

  it("keeps Messages selectable without a current session and explains the required context", async () => {
    renderOverlay({ currentSessionId: null, messages: [] });

    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Browse recent conversations...");
    expect(await screen.findByRole("button", { name: "Open Messages" })).toBeInTheDocument();
    const messagesButton = screen.getByRole("button", { name: "Messages" });
    expect(messagesButton).toBeEnabled();
    fireEvent.click(messagesButton);

    expect(messagesButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Current session required")).toBeInTheDocument();
    expect(screen.getByText(/Open a session to search its messages/)).toBeInTheDocument();
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
  });

  it("switches a Recent-origin query to Messages immediately and restores the browse state when cleared", async () => {
    // Recent filters and geometry belong to the browse flow, so a temporary message search must not erase or resize them.
    renderOverlay();
    await screen.findByTestId("recent-ask-bundle");
    fireEvent.click(screen.getByRole("button", { name: "Needs me" }));
    const sessionSpace = await screen.findByRole("combobox", {
      name: "Filter recent conversations by Session Space",
    });
    fireEvent.change(sessionSpace, { target: { value: "research" } });
    await waitFor(() =>
      expect(mockFetchRecentAskBundles).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: "needs_me", sessionSpaceId: "research" }),
      ),
    );
    mockSearchSessionMessages.mockClear();

    const input = screen.getByRole("searchbox");
    input.focus();
    fireEvent.change(input, { target: { value: "universal" } });

    expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Universal Search" })).toHaveClass("max-w-5xl");
    expect(screen.getByText("Messages mode")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByTestId("recent-ask-bundle")).toBeNull();
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
    expect(localStorage.getItem("cc-universal-search-mode")).toBeNull();

    await advanceSearchDebounce();
    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({ query: "universal" }),
      ),
    );

    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Needs me" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("combobox", { name: "Filter recent conversations by Session Space" })).toHaveValue(
      "research",
    );
  });

  it("cancels the Recent return path when another mode is clicked explicitly", () => {
    // Clearing a query after an explicit entity-mode choice must not override that deliberate destination.
    renderOverlay();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "quest wording" } });
    expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Quests" }));
    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("cc-universal-search-mode")).toBe("quests");
  });

  it("makes an auto-selected Messages mode explicit when its active tab is clicked", async () => {
    // Clicking the already-active tab is intentional mode selection; clearing afterward must not jump back to Recent.
    renderOverlay();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "search term" } });
    const messagesButton = screen.getByRole("button", { name: "Messages" });
    expect(messagesButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(messagesButton);
    expect(localStorage.getItem("cc-universal-search-mode")).toBe("messages");
    fireEvent.change(input, { target: { value: "" } });

    expect(messagesButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Enter a query to search messages.")).toBeInTheDocument();
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
  });

  it("treats Tab cycling as explicit mode selection and clears the query when it reaches Recent", () => {
    // All explicit mode paths share the same persistence and Recent-query clearing contract.
    renderOverlay({ initialMode: "starred", initialQuery: "retained elsewhere" });
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });

    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(localStorage.getItem("cc-universal-search-mode")).toBe("recent");
    expect(localStorage.getItem("cc-universal-search-query")).toBe("");
  });

  it("normalizes persisted Recent plus a query into a transient Messages search on reopen", async () => {
    // The stored explicit preference remains Recent even though its retained query resumes through Messages.
    localStorage.setItem("cc-universal-search-mode", "recent");
    localStorage.setItem("cc-universal-search-query", "persisted search");
    renderOverlay();

    expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox")).toHaveValue("persisted search");
    expect(screen.getByRole("dialog", { name: "Universal Search" })).toHaveClass("max-w-5xl");
    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({ query: "persisted search" }),
      ),
    );
    expect(localStorage.getItem("cc-universal-search-mode")).toBe("recent");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps explicit empty-query Messages idle instead of browsing recent messages", () => {
    // Message retrieval is exhaustive and query-driven; an empty explicit mode must not issue the legacy browse request.
    renderOverlay({ initialMode: "messages", initialQuery: "" });

    expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Enter a query to search messages.")).toBeInTheDocument();
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
  });

  it("restores persisted Session mode even without a current session", async () => {
    localStorage.setItem("cc-universal-search-mode", "sessions");
    renderOverlay({ currentSessionId: null, currentThreadKey: null, messages: [] });

    expect(screen.getByRole("button", { name: "Sessions" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("New session")).toBeInTheDocument();
    expect(mockListQuestPage).not.toHaveBeenCalled();
  });

  it("filters Session mode by name, branch, and path without running message-content search", async () => {
    const sessionModeSessions: SdkSessionInfo[] = [
      { ...sessions[0]!, name: "Planning worker", gitBranch: "feature/sidebar-overflow", cwd: "/repo/takode" },
      { ...sessions[1]!, name: "Review thread", gitBranch: "main", cwd: "/repo/other" },
    ];
    renderOverlay({ sessions: sessionModeSessions });

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sidebar overflow" } });
    await advanceSearchDebounce();

    expect(await screen.findByText("Planning worker")).toBeInTheDocument();
    expect(screen.getByText("branch feature/sidebar-overflow")).toBeInTheDocument();
    expect(screen.queryByText("Review thread")).not.toBeInTheDocument();
    expect(mockListQuestPage).not.toHaveBeenCalled();
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
  });

  it("opens the selected Session mode result", async () => {
    const callbacks = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(await screen.findByText("New session")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Old session"));

    expect(window.location.hash).toBe("#/session/s-old");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("searches whole-session Message mode for normal sessions only after a query", async () => {
    renderOverlay({ currentThreadKey: null, initialMode: "messages", initialQuery: "request" });

    expect(screen.getByRole("button", { name: "Messages" })).toBeEnabled();
    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalled());
    expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
      "s-new",
      expect.objectContaining({ query: "request", scope: "session", threadKey: undefined }),
    );
  });

  it("preserves every exhaustive Message hit even when several share one destination", async () => {
    // The server owns result completeness and identity; the browser must not deduplicate by session or thread route.
    mockSearchSessionMessages.mockResolvedValue(
      messageSearchResponse([
        messageResult({
          messageId: "same-tab-new",
          snippet: "Needle in the newest matching message",
          routeThreadKey: "main",
        }),
        messageResult({
          messageId: "same-tab-old",
          snippet: "Needle in an older matching message",
          routeThreadKey: "main",
          historyIndex: 4,
        }),
      ]),
    );
    renderOverlay({ initialMode: "messages", initialQuery: "needle" });

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Needle in the newest matching message");
    expect(options[1]).toHaveTextContent("Needle in an older matching message");
  });

  it("maps a leader All Threads selection to across-tabs Message search", async () => {
    // `all` is a feed projection, not a backend thread key, so it must never leak into current-thread requests.
    mockSearchSessionMessages.mockResolvedValue(
      messageSearchResponse([messageResult({ messageId: "all-tabs-result", snippet: "Match from any leader tab" })], {
        scope: { kind: "leader_all_tabs", label: "Searching in #11 across tabs" },
      }),
    );
    renderOverlay({
      currentThreadKey: "all",
      sessions: [{ ...sessions[0]!, isOrchestrator: true }, sessions[1]!],
      initialMode: "messages",
      initialQuery: "match",
    });

    expect(await screen.findByText("Searching in #11 across tabs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Across tabs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Current tab" })).toBeDisabled();
    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({ scope: "leader_all_tabs", threadKey: undefined }),
      ),
    );
    expect(mockSearchSessionMessages.mock.calls.some(([, options]) => options?.threadKey === "all")).toBe(false);
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
      initialMode: "messages",
      initialQuery: "thread specific",
    });

    expect(await screen.findByText("Searching in #11 thread q-1272")).toBeInTheDocument();

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
    renderOverlay({ sessions: leaderSessions, initialMode: "messages", initialQuery: "search" });

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

  it("removes old persisted starred-only Message filter state from Universal Search settings", async () => {
    localStorage.setItem(
      "cc-universal-search-message-settings",
      JSON.stringify({ scope: "session", filters: { user: true, assistant: false, event: false, starredOnly: true } }),
    );
    renderOverlay({ initialMode: "messages", initialQuery: "search" });

    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Starred" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Unstarred" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({
          filters: { user: true, assistant: false, event: false },
        }),
      ),
    );
    expect(JSON.parse(localStorage.getItem("cc-universal-search-message-settings") || "{}")).toEqual({
      scope: "session",
      filters: { user: true, assistant: false, event: false },
    });
  });

  it("renders Recent ask bundles, refetches filters, and preserves exact member navigation", async () => {
    const callbacks = renderOverlay({ initialMode: "recent" });

    await waitFor(() =>
      expect(mockFetchRecentAskBundles).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: "all", sessionSpaceId: null }),
      ),
    );
    const bundle = await screen.findByTestId("recent-ask-bundle");
    expect(within(bundle).getByText("Keep every correction independently navigable")).toBeInTheDocument();
    expect(within(bundle).getByText("1 attachment")).toBeInTheDocument();
    expect(screen.getByText("Some archived sessions are available only through Search.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Needs me" }));
    await waitFor(() =>
      expect(mockFetchRecentAskBundles).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "needs_me" })),
    );

    fireEvent.click(
      within(bundle).getByRole("button", {
        name: "Open newest message in #11 New session Build global Recent asks modal",
      }),
    );
    expect(callbacks.onOpenMessage).toHaveBeenCalledWith("s-new", "u-recent-2", "q-1931");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps response evidence off Recent cards and opens the canonical quest title", async () => {
    // The redesign hides only the response body; the response-backed unread status and authoritative response identity stay in the bundle data.
    const response = recentAskResponse();
    response.groups = response.groups.map((bundle) => ({
      ...bundle,
      status: "response_unread" as const,
      response: {
        messageId: "assistant-response",
        historyIndex: 9,
        timestamp: now - 5_000,
        preview: "This immediate agent response body must not render in Recent.",
        truncated: false,
      },
    }));
    mockFetchRecentAskBundles.mockResolvedValue(response);
    const callbacks = renderOverlay({ initialMode: "recent" });

    const bundle = await screen.findByTestId("recent-ask-bundle");
    expect(within(bundle).getByText("Response unread")).toBeInTheDocument();
    expect(within(bundle).queryByText("This immediate agent response body must not render in Recent.")).toBeNull();

    const questLink = within(bundle).getByRole("link", { name: "Build global Recent asks modal" });
    fireEvent.click(questLink);

    expect(useStore.getState().questOverlayId).toBe("q-1931");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenMessage).not.toHaveBeenCalledWith("s-new", "assistant-response", "q-1931");
  });

  it("compacts whitespace visually while expanding exact original formatting", async () => {
    // Collapsed CSS may compress line breaks for density, but the text node and expanded state must preserve the exact producer-authored content.
    const response = recentAskResponse();
    const baseGroup = response.groups[0]!;
    response.groups = [
      {
        ...baseGroup,
        id: "s-new:q-1931",
        members: [
          {
            messageId: "u-formatted",
            historyIndex: 7,
            timestamp: now - 20_000,
            preview: "Keep the exact wording.\n\n    Preserve the original indentation.",
            truncated: false,
            imageCount: 0,
          },
        ],
      },
      {
        ...baseGroup,
        id: "s-old:main",
        sessionId: "s-old",
        sessionNum: 12,
        sessionName: "Old session",
        ownerThreadKey: "main",
        questId: undefined,
        questTitle: undefined,
        questStatus: undefined,
        members: [
          {
            messageId: "u-truncated",
            historyIndex: 8,
            timestamp: now - 10_000,
            preview: "A longer exact request that continues…",
            truncated: true,
            imageCount: 0,
          },
        ],
      },
    ];
    mockFetchRecentAskBundles.mockResolvedValue(response);
    mockFetchMessagePreview.mockResolvedValue({
      content: "A longer exact request that continues\n\n- first preserved point\n- second preserved point",
    });
    renderOverlay({ initialMode: "recent" });

    const [formattedBundle, truncatedBundle] = await screen.findAllByTestId("recent-ask-bundle");
    const formattedText = within(formattedBundle!).getByTestId("recent-ask-text");
    expect(formattedText.textContent).toBe("Keep the exact wording.\n\n    Preserve the original indentation.");
    expect(formattedText).toHaveClass("whitespace-normal", "line-clamp-2");

    fireEvent.click(within(formattedBundle!).getByRole("button", { name: "Expand newest message" }));
    expect(formattedText).toHaveClass("whitespace-pre-wrap");
    expect(mockFetchMessagePreview).not.toHaveBeenCalled();

    fireEvent.click(within(truncatedBundle!).getByRole("button", { name: "Expand newest message" }));
    await waitFor(() => expect(mockFetchMessagePreview).toHaveBeenCalledWith("s-old", 8));
    await waitFor(() =>
      expect(within(truncatedBundle!).getByTestId("recent-ask-text").textContent).toContain("first preserved point"),
    );
    expect(within(truncatedBundle!).getByTestId("recent-ask-text")).toHaveClass("whitespace-pre-wrap");
  });

  it("requests global Starred mode results and renders session/thread context", async () => {
    mockSearchGlobalStarredMessages.mockResolvedValue(
      starredSearchResponse([
        starredMessageResult({
          messageId: "assistant-starred",
          sessionId: "s-old",
          sessionNum: 12,
          sessionName: "Old session",
          archived: true,
          reviewerOf: 11,
          routeThreadKey: "main",
          sourceThreadKey: "main",
          sourceLabel: "Main",
          snippet: "Starred assistant note about the search overlay",
        }),
      ]),
    );
    const callbacks = renderOverlay();

    fireEvent.click(await screen.findByRole("button", { name: "Starred" }));

    await waitFor(() =>
      expect(mockSearchGlobalStarredMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: "",
          limit: 20,
        }),
      ),
    );
    expect(mockSearchSessionMessages).not.toHaveBeenCalled();
    const resultRow = await screen.findByText("Starred assistant note about the search overlay");
    expect(resultRow.closest('[role="option"]')?.querySelector("svg")).not.toBeNull();
    const option = resultRow.closest('[role="option"]') as HTMLElement;
    expect(within(option).getByText("#12 Old session")).toBeInTheDocument();
    expect(within(option).getByText("Archived")).toBeInTheDocument();
    expect(within(option).getByText("Reviewer")).toBeInTheDocument();
    expect(within(option).getByText("Main")).toBeInTheDocument();
    fireEvent.click(option);
    expect(callbacks.onOpenMessage).toHaveBeenCalledWith("s-old", "assistant-starred", "main");
  });

  it("requests and renders Events-only Message results as event cards", async () => {
    localStorage.setItem(
      "cc-universal-search-message-settings",
      JSON.stringify({ scope: "leader_all_tabs", filters: { user: false, assistant: false, event: true } }),
    );
    mockSearchSessionMessages.mockResolvedValue(
      messageSearchResponse(
        [
          messageResult({
            messageId: "herd-event",
            role: "user",
            category: "event",
            snippet: "compact injected-system payload",
            sourceLabel: "Herd Events",
          }),
        ],
        {
          scope: { kind: "leader_all_tabs", label: "Searching in #11 across tabs" },
          filters: { user: false, assistant: false, event: true },
        },
      ),
    );

    renderOverlay({
      sessions: [{ ...sessions[0]!, isOrchestrator: true }, sessions[1]!],
      initialMode: "messages",
      initialQuery: "compact",
    });

    const [resultRow] = await screen.findAllByRole("option");
    expect(resultRow).toHaveTextContent("compact injected-system payload");
    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
        "s-new",
        expect.objectContaining({
          scope: "leader_all_tabs",
          filters: { user: false, assistant: false, event: true },
        }),
      ),
    );
    expect(within(resultRow!).getByText("compact").tagName).toBe("MARK");
    expect(within(resultRow!).getByText("event")).toBeInTheDocument();
    expect(within(resultRow!).queryByText("user")).not.toBeInTheDocument();
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
    const callbacks = renderOverlay({ initialMode: "messages", initialQuery: "zzzz" });
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
    expect(await screen.findByTestId("quest-hover-card")).toHaveClass("z-[90]");
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

  it("hides settled Message rows while a changed query is still debouncing", async () => {
    // Results for the previous query must disappear synchronously rather than looking like matches for the new text.
    mockSearchSessionMessages
      .mockResolvedValueOnce(
        messageSearchResponse([messageResult({ messageId: "old-settled", snippet: "Settled old-query result" })], {
          query: "old-query",
        }),
      )
      .mockResolvedValueOnce(
        messageSearchResponse([messageResult({ messageId: "new-settled", snippet: "Fresh new-query result" })], {
          query: "new-query",
        }),
      );
    renderOverlay({ initialMode: "messages", initialQuery: "old-query" });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("Settled old-query result"));
    expect(mockSearchSessionMessages).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "new-query" } });

    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByLabelText("Searching")).toBeInTheDocument();
    expect(mockSearchSessionMessages).toHaveBeenCalledTimes(1);
    await advanceSearchDebounce();
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("Fresh new-query result"));
  });

  it("ignores stale Message search responses after the query changes", async () => {
    let resolveOld!: (value: MessageSearchResponse) => void;
    let resolveNew!: (value: MessageSearchResponse) => void;
    mockSearchSessionMessages
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

    renderOverlay({ initialMode: "messages", initialQuery: "old" });

    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalledTimes(1));
    const input = screen.getByRole("searchbox");
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
    const callbacks = renderOverlay({ initialMode: "messages", initialQuery: "zzzz" });
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });

    await screen.findByText("Recent user request about universal search");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(callbacks.onOpenMessage).toHaveBeenCalledWith("s-new", "user-old", "main");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);

    callbacks.onClose.mockClear();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Starred" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter while the search input is in IME composition", async () => {
    const callbacks = renderOverlay({ initialMode: "messages", initialQuery: "zzzz" });
    const dialog = screen.getByRole("dialog", { name: "Universal Search" });

    await screen.findByText("Recent user request about universal search");
    fireEvent.keyDown(dialog, { key: "Enter", isComposing: true });
    fireEvent.keyDown(dialog, { key: "Enter", keyCode: 229 });

    expect(callbacks.onOpenMessage).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(callbacks.onOpenMessage).toHaveBeenCalledWith("s-new", "user-new", "main");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});
