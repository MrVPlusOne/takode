// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { BoardRowData } from "./BoardTable.js";
import type { QuestmasterTask, SessionAttentionRecord } from "../types.js";
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
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  activeTurnRoutes: Map<string, unknown>;
}

let mockState: MockStoreState;
const mockRequestScrollToMessage = vi.fn();
const mockSetExpandAllInTurn = vi.fn();

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
    sessionStatus: new Map(),
    activeTurnRoutes: new Map(),
    ...overrides,
  };
}

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (s: MockStoreState) => unknown) => selector(mockState), {
    getState: () => ({
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

  it("upgrades a fallback-first open tab when Questmaster title hydration arrives", () => {
    // Reconnect/snapshot hydration can know only the open key and a fallback
    // row first; later Questmaster hydration must improve the title in place.
    const { container, rerender } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        threadRows={[{ threadKey: "q-1768", questId: "q-1768", title: "q-1768", messageCount: 1 }]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent(/q-1768\s*q-1768/);

    mockState.quests = [quest("q-1768", "Hydrated canonical title")];
    rerender(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        threadRows={[{ threadKey: "q-1768", questId: "q-1768", title: "q-1768", messageCount: 1 }]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent("Hydrated canonical title");
  });

  it("keeps a canonical title after completion or cancellation removes board rows", () => {
    // q-1768 ended up as an open tab after cancellation with no active board
    // row. The persisted open key should still render from Questmaster data.
    const { container, rerender } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        threadRows={[{ threadKey: "q-1768", questId: "q-1768", title: "Run GPT-5.4 eval", messageCount: 2 }]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent("Run GPT-5.4 eval");

    mockState.quests = [quest("q-1768", "Run GPT-5.4 eval")];
    mockState.sessionBoards = new Map([["s1", []]]);
    mockState.sessionCompletedBoards = new Map([["s1", []]]);
    rerender(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1768"]}
        attentionRecords={[reviewAttention("q-1768", "Thread ready: q-1768 | cancelled")]}
      />,
    );

    expect(getTabTitle(container, "q-1768")).toHaveTextContent("Run GPT-5.4 eval");
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
