// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, QuestmasterTask, SessionState } from "../types.js";
import { api } from "../api.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";
import { QuestRecordFetchContext } from "./QuestSummaryCard.js";

// Leader quest threads often begin with nothing but tool activity, so the thread
// opens with a card showing what the quest is about: its description TLDR,
// expandable to the full description, read from the server quest record.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"description"' }) },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-description-summary";
const QUEST_ID = "q-4300";
const TLDR = "Run Takode workers on the DevBox.";
const DESCRIPTION =
  "## Background\nThe DevBox has idle GPUs.\n\n## Goal\nRegister it as a Takode host and run a worker there.";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });
const route = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
};

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

beforeEach(() => {
  useStore.getState().reset();
  sendToSession.mockClear();
  vi.mocked(api.getQuestValidated).mockClear();
});
afterEach(cleanup);

function session(isOrchestrator: boolean): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator,
    backend_type: "claude-sdk",
    model: "claude-opus",
    cwd: "/tmp/takode",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/tmp/takode",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function activeQuest(overrides: Partial<Extract<QuestmasterTask, { status: "in_progress" }>> = {}): QuestmasterTask {
  return {
    id: "description-summary-quest",
    questId: QUEST_ID,
    version: 1,
    title: "Set up the DevBox as a Takode host",
    tldr: TLDR,
    description: DESCRIPTION,
    status: "in_progress",
    createdAt: 1,
    sessionId: "worker",
    claimedAt: 1,
    ...overrides,
  };
}

/**
 * The reported shape: the quest thread starts with dispatch tool activity, then
 * herd events from the worker, with no prose saying what the quest is about.
 */
function dispatchHistory(): BrowserIncomingMessage[] {
  return Array.from({ length: 3 }, (_, index): BrowserIncomingMessage[] => [
    {
      type: "user_message",
      id: `herd-${index}`,
      content: `1 event from 1 session\n\n#12 | turn_end | step ${index + 1}`,
      timestamp: 1_700_000_000_000 + index * 2,
      agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      ...route,
    },
    {
      type: "assistant",
      timestamp: 1_700_000_000_001 + index * 2,
      parent_tool_use_id: null,
      leaderThreadRole: "commentary",
      ...route,
      message: {
        id: `dispatch-${index}`,
        type: "message",
        role: "assistant",
        model: "claude-opus",
        content: [{ type: "tool_use", id: `tool-${index}`, name: "Bash", input: { command: "takode board show" } }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
  ]).flat();
}

/**
 * The reported empty-thread shape: the leader discussed and dispatched the quest, but
 * every message was routed to Main or another quest, so its own thread has none.
 */
function elsewhereRoutedHistory(): BrowserIncomingMessage[] {
  const otherQuest = "q-4301";
  return [
    { type: "user_message", id: "main-ask", content: `Please start ${QUEST_ID}.`, timestamp: 1_700_000_000_000 },
    {
      type: "assistant",
      timestamp: 1_700_000_000_001,
      parent_tool_use_id: null,
      leaderThreadRole: "commentary",
      threadKey: otherQuest,
      questId: otherQuest,
      threadRefs: [{ threadKey: otherQuest, questId: otherQuest, source: "explicit" }],
      message: {
        id: "other-update",
        type: "message",
        role: "assistant",
        model: "claude-opus",
        content: [
          { type: "text", text: `The prerequisite landed, so [${QUEST_ID}](quest:${QUEST_ID}) can start now.` },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
  ];
}

function installThread(
  quest: QuestmasterTask | null,
  {
    fromItem = 0,
    isOrchestrator = true,
    history = dispatchHistory(),
  }: { fromItem?: number; isOrchestrator?: boolean; history?: BrowserIncomingMessage[] } = {},
): void {
  // Use the shared producer so the browser receives the normal thread window shape.
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem,
    itemCount: 1,
    sectionItemCount: 1,
    visibleItemCount: 3,
  });
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: session(isOrchestrator) });
    if (quest) useStore.getState().upsertQuestDetail(quest, { etag: '"description"' });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: QUEST_ID,
      entries: sync.entries,
      window: sync.window,
    });
  });
}

describe("MessageFeed quest description summary", () => {
  it("opens the thread with the description TLDR and keeps it through collapse toggles", () => {
    installThread(activeQuest());
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const card = screen.getByTestId("quest-description-summary");
    expect(card).toHaveTextContent(TLDR);
    expect(card).toHaveTextContent("Set up the DevBox as a Takode host");
    // It sits before the thread's first turn, not inside any turn.
    const firstTurn = document.querySelector<HTMLElement>("[data-turn-id]")!;
    expect(firstTurn).not.toContainElement(card);
    expect(card.compareDocumentPosition(firstTurn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const toggle = within(firstTurn).getByRole("button", { name: /turn activity/ });
    fireEvent.click(toggle);
    fireEvent.click(within(firstTurn).getByRole("button", { name: /turn activity/ }));
    expect(screen.getAllByTestId("quest-description-summary")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByTestId("quest-description-summary")).toHaveTextContent("Register it as a Takode host");
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getByTestId("quest-description-summary")).not.toHaveTextContent("Register it");
    // A current cached record needs no request.
    expect(api.getQuestValidated).not.toHaveBeenCalled();
  });

  it("shows a description excerpt, skipping headings, when the quest has no TLDR", () => {
    installThread(activeQuest({ tldr: undefined }));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const card = screen.getByTestId("quest-description-summary");
    expect(card).toHaveTextContent("The DevBox has idle GPUs.");
    expect(card).not.toHaveTextContent("Background");
    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByTestId("quest-description-summary")).toHaveTextContent("Register it as a Takode host");
  });

  it("offers no toggle when the description is already shown in full", () => {
    installThread(activeQuest({ tldr: undefined, description: "Register the DevBox as a host." }));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByTestId("quest-description-summary")).toHaveTextContent("Register the DevBox as a host.");
    expect(screen.queryByRole("button", { name: "Show full description" })).not.toBeInTheDocument();
  });

  it("loads a missing record once and refetches when a live update reports a newer quest", async () => {
    vi.mocked(api.getQuestValidated).mockResolvedValueOnce({
      status: "fresh",
      etag: '"v1"',
      data: activeQuest(),
    });
    installThread(null);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(await screen.findByTestId("quest-description-summary")).toHaveTextContent(TLDR);
    expect(api.getQuestValidated).toHaveBeenCalledTimes(1);
    expect(api.getQuestValidated).toHaveBeenCalledWith(QUEST_ID, null);

    // A refined description arrives as a newer live title preview.
    const refined = activeQuest({ version: 2, tldr: "Run GPU workers on the DevBox." });
    vi.mocked(api.getQuestValidated).mockResolvedValueOnce({ status: "fresh", etag: '"v2"', data: refined });
    act(() => {
      useStore
        .getState()
        .upsertQuestTitlePreview({ questId: QUEST_ID, title: refined.title, version: 2, updatedAt: 1 });
    });
    expect(await screen.findByText("Run GPU workers on the DevBox.")).toBeInTheDocument();
    expect(api.getQuestValidated).toHaveBeenCalledTimes(2);
    expect(api.getQuestValidated).toHaveBeenLastCalledWith(QUEST_ID, '"v1"');
  });

  it("never fetches when record loading is turned off, as in the Playground", () => {
    // Playground fixtures must not load or show real quests from the live server;
    // they show only records seeded into the store.
    installThread(null);
    const view = render(
      <QuestRecordFetchContext.Provider value={false}>
        <MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />
      </QuestRecordFetchContext.Provider>,
    );
    expect(screen.queryByTestId("quest-description-summary")).not.toBeInTheDocument();

    act(() => {
      useStore.getState().upsertQuestDetail(activeQuest(), { etag: '"description"' });
    });
    expect(screen.getByTestId("quest-description-summary")).toHaveTextContent(TLDR);
    act(() => {
      useStore.getState().upsertQuestTitlePreview({ questId: QUEST_ID, title: "Newer", version: 5, updatedAt: 9 });
    });
    view.unmount();
    expect(api.getQuestValidated).not.toHaveBeenCalled();
  });

  it("shows the card instead of the empty placeholder when the quest thread has no messages", async () => {
    // Every message about the quest was routed elsewhere, so the producer's window for
    // this thread is empty; the card still says what the quest is about.
    vi.mocked(api.getQuestValidated).mockResolvedValueOnce({ status: "fresh", etag: '"v1"', data: activeQuest() });
    installThread(null, { history: elsewhereRoutedHistory() });
    const window = useStore.getState().threadWindows.get(SESSION_ID)!.get(QUEST_ID)!;
    expect(window.total_items).toBe(0);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    // The generic placeholder covers the moment before the record loads.
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    expect(await screen.findByTestId("quest-description-summary")).toHaveTextContent(TLDR);
    expect(screen.queryByText("Start a conversation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByTestId("quest-description-summary")).toHaveTextContent("Register it as a Takode host");
  });

  it("keeps the empty placeholder for an empty quest thread outside a leader session", () => {
    installThread(activeQuest(), { history: elsewhereRoutedHistory(), isOrchestrator: false });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    expect(screen.queryByTestId("quest-description-summary")).not.toBeInTheDocument();
  });

  it("waits for the thread's first section before showing the card", () => {
    installThread(activeQuest(), { fromItem: 2 });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByRole("button", { name: "Load older section" })).toBeInTheDocument();
    expect(screen.queryByTestId("quest-description-summary")).not.toBeInTheDocument();
  });

  it("renders no card outside a leader session", () => {
    installThread(activeQuest(), { isOrchestrator: false });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.queryByTestId("quest-description-summary")).not.toBeInTheDocument();
  });

  it("renders no card for a quest with neither TLDR nor description", () => {
    installThread(activeQuest({ tldr: undefined, description: "" }));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getAllByRole("button", { name: /turn activity/ }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("quest-description-summary")).not.toBeInTheDocument();
  });
});
