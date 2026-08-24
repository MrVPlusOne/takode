// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { BoardRowData } from "./BoardTable.js";
import type { QuestTitlePreview, QuestmasterTask, SessionAttentionRecord } from "../types.js";
import type { LeaderWorkboardView } from "../store-types.js";

interface MockStoreState {
  sessionBoards: Map<string, BoardRowData[]>;
  sessionCompletedBoards: Map<string, BoardRowData[]>;
  sessionBoardRowStatuses: Map<string, Record<string, unknown>>;
  leaderWorkboardViews: Map<string, LeaderWorkboardView>;
  setLeaderWorkboardView: (sessionId: string, view: LeaderWorkboardView | null) => void;
  sdkSessions: Array<{ sessionId: string; isOrchestrator?: boolean }>;
  sessions: Map<string, unknown>;
  sessionNames: Map<string, string>;
  sessionPreviews: Map<string, string>;
  sessionTaskHistory: Map<string, unknown[]>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  cliConnected: Map<string, boolean>;
  askPermission: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | null>;
  quests: QuestmasterTask[];
  questDetails: Map<string, QuestmasterTask>;
  questDetailEtags: Map<string, string>;
  upsertQuestDetail: (quest: QuestmasterTask, opts?: { etag?: string | null }) => void;
  questTitlePreviews: Map<string, QuestTitlePreview | null>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  activeTurnRoutes: Map<string, unknown>;
}

let mockState: MockStoreState;
const mockRequestScrollToMessage = vi.fn();
const mockSetExpandAllInTurn = vi.fn();

const mockGetQuestValidated = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: mockGetQuestValidated,
  },
}));

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    leaderWorkboardViews: new Map(),
    setLeaderWorkboardView: vi.fn((sessionId: string, view: LeaderWorkboardView | null) => {
      if (view) mockState.leaderWorkboardViews.set(sessionId, view);
      else mockState.leaderWorkboardViews.delete(sessionId);
    }),
    sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
    sessions: new Map(),
    sessionNames: new Map(),
    sessionPreviews: new Map(),
    sessionTaskHistory: new Map(),
    pendingPermissions: new Map(),
    cliConnected: new Map(),
    askPermission: new Map(),
    cliDisconnectReason: new Map(),
    quests: [],
    questDetails: new Map(),
    questDetailEtags: new Map(),
    upsertQuestDetail: vi.fn((quest: QuestmasterTask, opts?: { etag?: string | null }) => {
      mockState.questDetails = new Map(mockState.questDetails).set(quest.questId.toLowerCase(), quest);
      if (opts?.etag) mockState.questDetailEtags = new Map(mockState.questDetailEtags).set(quest.questId, opts.etag);
    }),
    questTitlePreviews: new Map(),
    sessionStatus: new Map(),
    activeTurnRoutes: new Map(),
    ...overrides,
  };
}

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (s: MockStoreState) => unknown) => selector(mockState), {
    getState: () => ({
      ...mockState,
      requestScrollToMessage: mockRequestScrollToMessage,
      setExpandAllInTurn: mockSetExpandAllInTurn,
    }),
  }),
  countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
}));

vi.mock("./BoardTable.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./BoardTable.js")>();
  return {
    ...actual,
    BoardTable: ({ board }: { board: BoardRowData[] }) => <div data-testid="board-table">{board.length} rows</div>,
  };
});

const { WorkBoardBar } = await import("./WorkBoardBar.js");

function quest(questId: string, title: string, status: QuestmasterTask["status"] = "done"): QuestmasterTask {
  return {
    id: `${questId}-v1`,
    questId,
    version: 1,
    title,
    status,
    description: "Test quest",
    createdAt: 1,
    completedAt: status === "done" ? 2 : undefined,
    verificationItems: status === "done" ? [] : undefined,
  } as QuestmasterTask;
}

function reviewAttention(questId: string, title: string): SessionAttentionRecord {
  return {
    id: `review:${questId}`,
    leaderSessionId: "s1",
    type: "review_ready",
    source: { kind: "notification", id: `n-${questId}`, questId },
    questId,
    threadKey: questId,
    title,
    summary: title,
    actionLabel: "Review",
    priority: "review",
    state: "unresolved",
    createdAt: 10,
    updatedAt: 10,
    route: { threadKey: questId, questId },
    chipEligible: true,
    ledgerEligible: true,
    dedupeKey: `review:${questId}`,
  };
}

function getTabTitle(container: HTMLElement, threadKey: string): HTMLElement {
  const tab = within(container)
    .getAllByTestId("thread-tab")
    .find((candidate) => candidate.getAttribute("data-thread-key") === threadKey);
  if (!tab) throw new Error(`Missing tab ${threadKey}`);
  return within(tab).getByTestId("thread-tab-title");
}

describe("WorkBoardBar tab title source precedence", () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
    localStorage.setItem("cc-server-id", "test-server");
    mockRequestScrollToMessage.mockClear();
    mockSetExpandAllInTurn.mockClear();
    mockGetQuestValidated.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps the Questmaster title when a later partial review record only has the quest id", () => {
    // This matches the q-1768 screenshot shape: the open tab is retained by key,
    // while a later Thread Ready/review source carries no canonical title.
    resetStore({ quests: [quest("q-1768", "Run GPT-5.4 reasoning-effort QA eval")] });

    const { container } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        attentionRecords={[reviewAttention("q-1768", "q-1768")]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent("Run GPT-5.4 reasoning-effort QA eval");
  });

  it("does not let attention fallback downgrade an authoritative board-row title", () => {
    // Active board rows are authoritative producer data for active leader tabs;
    // attention records should add badges, not replace the title with a fallback.
    resetStore({
      sessionBoards: new Map([
        ["s1", [{ questId: "q-1768", title: "Canonical board title", status: "WORKING", updatedAt: 20 }]],
      ]),
    });

    const { container } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        attentionRecords={[reviewAttention("q-1768", "q-1768")]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent("Canonical board title");
  });

  it("upgrades a fallback-first open tab when bounded title hydration arrives", () => {
    // Reconnect/snapshot hydration can know only the open key and a fallback
    // row first; a targeted title-only response must improve it in place.
    const { container, rerender } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1932"]}
        threadRows={[{ threadKey: "q-1932", questId: "q-1932", title: "q-1932", messageCount: 1 }]}
      />,
    );

    expect(getTabTitle(container, "q-1932")).toHaveTextContent(/q-1932\s*q-1932/);

    mockState.questTitlePreviews = new Map([
      ["q-1932", { questId: "q-1932", title: "Resolve VSCode QA Stack Conflicts", version: 3, updatedAt: 30 }],
    ]);
    rerender(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1932"]}
        threadRows={[{ threadKey: "q-1932", questId: "q-1932", title: "q-1932", messageCount: 1 }]}
      />,
    );

    expect(getTabTitle(container, "q-1932")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
  });

  it("keeps a retained cancelled tab titled after board removal and default-list omission", () => {
    // Production q-1932 had no active/completed board row and was omitted from
    // the paged global quest cache, but the server-owned open key remained.
    resetStore({
      questTitlePreviews: new Map([
        ["q-1932", { questId: "q-1932", title: "Resolve VSCode QA Stack Conflicts", version: 3, updatedAt: 30 }],
      ]),
    });

    const { container } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1932"]}
        attentionRecords={[reviewAttention("q-1932", "Thread ready: q-1932 | cancelled")]}
      />,
    );

    expect(getTabTitle(container, "q-1932")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
    expect(within(container).getByTestId("thread-tab")).toHaveAttribute("data-thread-key", "q-1932");
  });

  it("loads the rich tab hover by id when only the title projection is cached", async () => {
    const fetched = quest("q-1932", "Resolve VSCode QA Stack Conflicts");
    mockGetQuestValidated.mockResolvedValueOnce({ status: "fresh", data: fetched, etag: '"detail-v3"' });
    resetStore({
      questTitlePreviews: new Map([["q-1932", { questId: "q-1932", title: fetched.title, version: 3, updatedAt: 30 }]]),
    });

    const view = render(<WorkBoardBar sessionId="s1" openThreadKeys={["q-1932"]} />);
    const tab = view.getByTestId("thread-tab");
    fireEvent.mouseEnter(tab);

    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-1932", null);
    const card = await view.findByTestId("quest-hover-card");
    expect(within(card).getByTestId("quest-hover-title")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
  });

  it("clears the previous tab hover while a different uncached tab hydrates", async () => {
    const cached = quest("q-1931", "First cached quest");
    const hydrated = quest("q-1932", "Second hydrated quest");
    let resolveSecond: ((value: { status: "fresh"; data: QuestmasterTask; etag: string }) => void) | undefined;
    mockGetQuestValidated.mockResolvedValueOnce({ status: "not-modified", etag: '"detail-a"' }).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    resetStore({
      questDetails: new Map([["q-1931", cached]]),
      questDetailEtags: new Map([["q-1931", '"detail-a"']]),
      questTitlePreviews: new Map([
        ["q-1931", { questId: "q-1931", title: cached.title, version: 1, updatedAt: 10 }],
        ["q-1932", { questId: "q-1932", title: hydrated.title, version: 1, updatedAt: 10 }],
      ]),
    });

    const view = render(<WorkBoardBar sessionId="s1" openThreadKeys={["q-1931", "q-1932"]} />);
    const [firstTab, secondTab] = view.getAllByTestId("thread-tab");
    fireEvent.mouseEnter(firstTab);
    expect(await view.findByTestId("quest-hover-card")).toHaveTextContent("First cached quest");

    fireEvent.mouseLeave(firstTab);
    fireEvent.mouseEnter(secondTab);
    expect(view.queryByTestId("quest-hover-card")).toBeNull();

    resolveSecond?.({ status: "fresh", data: hydrated, etag: '"detail-b"' });
    expect(await view.findByTestId("quest-hover-card")).toHaveTextContent("Second hydrated quest");
  });

  it("updates an open cached hover after pointer handoff while revalidation is pending", async () => {
    const cached = {
      ...quest("q-1932", "Cached title"),
      id: "q-1932-v2",
      version: 2,
      updatedAt: 20,
    } as QuestmasterTask;
    const fresh = {
      ...quest("q-1932", "Fresh canonical title"),
      id: "q-1932-v3",
      version: 3,
      updatedAt: 30,
    } as QuestmasterTask;
    let resolveFresh: ((value: { status: "fresh"; data: QuestmasterTask; etag: string }) => void) | undefined;
    mockGetQuestValidated.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFresh = resolve;
      }),
    );
    resetStore({
      questDetails: new Map([["q-1932", cached]]),
      questDetailEtags: new Map([["q-1932", '"detail-v2"']]),
      questTitlePreviews: new Map([["q-1932", { questId: "q-1932", title: cached.title, version: 2, updatedAt: 20 }]]),
    });

    const view = render(<WorkBoardBar sessionId="s1" openThreadKeys={["q-1932"]} />);
    const tab = view.getByTestId("thread-tab");
    fireEvent.mouseEnter(tab);
    const card = await view.findByTestId("quest-hover-card");
    expect(within(card).getByTestId("quest-hover-title")).toHaveTextContent("Cached title");

    fireEvent.mouseLeave(tab);
    fireEvent.mouseEnter(card);
    resolveFresh?.({ status: "fresh", data: fresh, etag: '"detail-v3"' });

    expect(await view.findByText("Fresh canonical title")).toBeInTheDocument();
    expect(within(view.getByTestId("quest-hover-card")).getByTestId("quest-hover-title")).toHaveTextContent(
      "Fresh canonical title",
    );
  });

  it("keeps a newer title projection over stale cached detail and revalidates hover metadata", async () => {
    const staleDetail = {
      ...quest("q-1932", "Old cached title"),
      id: "q-1932-v2",
      version: 2,
      updatedAt: 20,
    } as QuestmasterTask;
    const freshDetail = {
      ...quest("q-1932", "Resolve VSCode QA Stack Conflicts"),
      id: "q-1932-v3",
      version: 3,
      updatedAt: 30,
    } as QuestmasterTask;
    mockGetQuestValidated.mockResolvedValueOnce({ status: "fresh", data: freshDetail, etag: '"detail-v3"' });
    resetStore({
      questDetails: new Map([["q-1932", staleDetail]]),
      questDetailEtags: new Map([["q-1932", '"detail-v2"']]),
      questTitlePreviews: new Map([
        ["q-1932", { questId: "q-1932", title: freshDetail.title, version: 3, updatedAt: 30 }],
      ]),
    });

    const view = render(<WorkBoardBar sessionId="s1" openThreadKeys={["q-1932"]} />);
    const tab = view.getByTestId("thread-tab");
    expect(within(tab).getByTestId("thread-tab-title")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
    expect(tab).not.toHaveTextContent("Old cached title");

    fireEvent.mouseEnter(tab);
    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-1932", '"detail-v2"');
    const card = await view.findByTestId("quest-hover-card");
    expect(within(card).getByTestId("quest-hover-title")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
  });

  it("uses targeted Quest Detail cache titles without polluting the paged quest list", () => {
    resetStore({
      quests: [],
      questDetails: new Map([["q-1932", quest("q-1932", "Resolve VSCode QA Stack Conflicts")]]),
    });

    const { container } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1932"]}
        threadRows={[{ threadKey: "q-1932", questId: "q-1932", title: "q-1932", messageCount: 2 }]}
      />,
    );

    expect(getTabTitle(container, "q-1932")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
  });

  it("uses completed-board title over partial thread-row and notification titles", () => {
    // Completed-tab retention keeps finished tabs selectable; stale thread or
    // notification summaries must not degrade the retained completed title.
    resetStore({
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-1768", title: "Completed canonical title", status: "MEMORY", updatedAt: 30 }]],
      ]),
    });

    const { container } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        threadRows={[{ threadKey: "q-1768", questId: "q-1768", title: "q-1768", messageCount: 1, section: "done" }]}
        attentionRecords={[reviewAttention("q-1768", "q-1768")]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent("Completed canonical title");
  });
});
