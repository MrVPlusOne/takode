// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";

const mockListQuestPage = vi.fn();
const mockSearchSessions = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listQuestPage: (...args: unknown[]) => mockListQuestPage(...args),
    searchSessions: (...args: unknown[]) => mockSearchSessions(...args),
  },
}));

import { UniversalSearchOverlay } from "./UniversalSearchOverlay.js";
import { useStore } from "../store.js";
import type { ChatMessage, QuestmasterTask, SdkSessionInfo } from "../types.js";

const now = 1778274000000;
type OverlayProps = ComponentProps<typeof UniversalSearchOverlay>;
type OnCloseMock = ReturnType<typeof vi.fn<OverlayProps["onClose"]>>;
type OnOpenQuestMock = ReturnType<typeof vi.fn<OverlayProps["onOpenQuest"]>>;
type OnOpenSessionMock = ReturnType<typeof vi.fn<OverlayProps["onOpenSession"]>>;
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

function quest(overrides: Partial<QuestmasterTask> & Pick<QuestmasterTask, "questId" | "title">): QuestmasterTask {
  return {
    status: "in_progress",
    createdAt: now - 60_000,
    statusChangedAt: now - 20_000,
    tags: [],
    ...overrides,
  } as QuestmasterTask;
}

function renderOverlay(
  props: Partial<ComponentProps<typeof UniversalSearchOverlay>> = {},
  callbacks: {
    onOpenQuest?: OnOpenQuestMock;
    onOpenSession?: OnOpenSessionMock;
    onOpenMessage?: OnOpenMessageMock;
    onClose?: OnCloseMock;
  } = {},
) {
  const onClose = callbacks.onClose ?? vi.fn<OverlayProps["onClose"]>(() => undefined);
  const onOpenQuest = callbacks.onOpenQuest ?? vi.fn<OverlayProps["onOpenQuest"]>(() => undefined);
  const onOpenSession = callbacks.onOpenSession ?? vi.fn<OverlayProps["onOpenSession"]>(() => undefined);
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
      onOpenSession={onOpenSession}
      onOpenMessage={onOpenMessage}
      {...props}
    />,
  );
  return { ...view, onClose, onOpenQuest, onOpenSession, onOpenMessage };
}

async function advanceSearchDebounce() {
  await new Promise((resolve) => window.setTimeout(resolve, 330));
}

describe("UniversalSearchOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
    mockListQuestPage.mockClear();
    mockSearchSessions.mockClear();
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
    mockSearchSessions.mockResolvedValue({ query: "", tookMs: 1, totalMatches: 0, results: [] });
  });

  afterEach(() => {
    useStore.getState().setQuests([]);
    useStore.getState().setSdkSessions([]);
    vi.restoreAllMocks();
  });

  it("defaults to current-session message mode and lists recent user messages for an empty query", async () => {
    renderOverlay();

    expect(await screen.findByText("Recent user request about universal search")).toBeInTheDocument();
    expect(screen.getByText("Older user request about search controls")).toBeInTheDocument();
    expect(screen.queryByText("Assistant note about the search overlay")).not.toBeInTheDocument();
    expect(mockListQuestPage).not.toHaveBeenCalled();
    expect(mockSearchSessions).not.toHaveBeenCalled();
  });

  it("keeps Message mode disabled when there is no current session context", () => {
    renderOverlay({ currentSessionId: null, messages: [] });

    expect(screen.getByRole("button", { name: "Messages" })).toBeDisabled();
    expect(screen.getByText(/New session/)).toBeInTheDocument();
  });

  it("keeps Message mode disabled when there is no current thread context", async () => {
    renderOverlay({ currentThreadKey: null });

    expect(screen.getByRole("button", { name: "Messages" })).toBeDisabled();
    expect(await screen.findByText(/New session/)).toBeInTheDocument();
  });

  it("uses Main feed projection for empty-query Message recents and typed Message search", async () => {
    renderOverlay({ currentThreadKey: "main", messages: threadScopedMessages });

    expect(await screen.findByText("Visible main request about apples")).toBeInTheDocument();
    expect(screen.queryByText("Hidden quest dragonfruit request")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden quest reference with banana")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dragonfruit" } });
    await advanceSearchDebounce();

    expect(screen.queryByText("Hidden quest dragonfruit request")).not.toBeInTheDocument();
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  it("uses quest-thread projection for empty-query Message recents and typed Message search", async () => {
    renderOverlay({ currentThreadKey: "q-1272", messages: threadScopedMessages });

    expect(await screen.findByText("Quest thread-specific request about pears")).toBeInTheDocument();
    expect(screen.getByText("Hidden quest dragonfruit request")).toBeInTheDocument();
    expect(screen.getByText("Hidden quest reference with banana")).toBeInTheDocument();
    expect(screen.queryByText("Visible main request about apples")).not.toBeInTheDocument();
    expect(screen.queryByText("Other quest thread-specific request about pears")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "thread-specific" } });
    await advanceSearchDebounce();

    expect(await screen.findByText("Quest thread-specific request about pears")).toBeInTheDocument();
    expect(screen.queryByText("Other quest thread-specific request about pears")).not.toBeInTheDocument();
    expect(screen.queryByText("Visible main request about apples")).not.toBeInTheDocument();
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
    expect(mockSearchSessions).not.toHaveBeenCalled();
    expect(await screen.findByText("Recently updated quest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "q-101" })).toBeInTheDocument();
  });

  it("remembers the last selected mode when reopened", async () => {
    const { rerender, onClose, onOpenQuest, onOpenSession, onOpenMessage } = renderOverlay();

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
        onOpenSession={onOpenSession}
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
        onOpenSession={onOpenSession}
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
        onOpenSession={callbacks.onOpenSession}
        onOpenMessage={callbacks.onOpenMessage}
      />,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mockListQuestPage).toHaveBeenCalledTimes(1);
  });

  it("renders quest owner metadata as quest and session links instead of tags", async () => {
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

    renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Quests" }));

    expect(await screen.findByRole("link", { name: "q-303" })).toBeInTheDocument();
    expect(screen.queryByText("#hidden-tag")).not.toBeInTheDocument();
    expect(screen.getByText("leader")).toBeInTheDocument();
    expect(screen.getByText("worker")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#11" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#12" })).toBeInTheDocument();
  });

  it("ignores stale session search responses after the query changes", async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    mockSearchSessions
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );

    renderOverlay({ currentSessionId: null, messages: [] });

    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "old" } });
    await advanceSearchDebounce();
    fireEvent.change(input, { target: { value: "new" } });
    await advanceSearchDebounce();

    resolveNew({
      query: "new",
      tookMs: 1,
      totalMatches: 1,
      results: [{ sessionId: "s-new", score: 10, matchedField: "name", matchContext: "new", matchedAt: now }],
    });
    await screen.findByText(/New session/);

    resolveOld({
      query: "old",
      tookMs: 1,
      totalMatches: 1,
      results: [{ sessionId: "s-old", score: 10, matchedField: "name", matchContext: "old", matchedAt: now }],
    });
    await waitFor(() => expect(screen.queryByText(/Old session/)).not.toBeInTheDocument());
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
