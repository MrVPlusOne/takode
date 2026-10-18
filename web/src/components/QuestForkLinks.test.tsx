// @vitest-environment jsdom
/**
 * Links between the two ends of a conversation fork: a quest thread filed from one of the
 * user's messages opens with a link back to it, and the message links on to the quest.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, QuestmasterTask, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";
import { ContinuedInLinks, StartedQuestsProvider } from "./QuestForkLinks.js";

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"fork"' }),
    getQuestTitles: vi.fn().mockResolvedValue({ quests: [], missingQuestIds: [] }),
  },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-forks";
const QUEST_ID = "q-9";
// Sent earlier today, so the link shows just the time.
const SENT_AT = new Date().setHours(11, 51, 0, 0);
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });

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
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
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

/** The user asks in Main; the leader files q-9 from that message. */
const HISTORY: BrowserIncomingMessage[] = [
  { type: "user_message", id: "main-ask", content: "Please fix the relay timeout.", timestamp: SENT_AT },
];
/** The same request after the leader moved it into q-9 (Main-to-quest handoff); Main still shows it. */
const HANDED_OFF_HISTORY: BrowserIncomingMessage[] = [
  {
    type: "user_message",
    id: "main-ask",
    content: "Please fix the relay timeout.",
    timestamp: SENT_AT,
    threadKey: "main",
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit", attachedAt: SENT_AT + 1 }],
  },
];

function installThread(threadKey: string, history: BrowserIncomingMessage[], quest?: QuestmasterTask): void {
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey,
    fromItem: 0,
    itemCount: 1,
    sectionItemCount: 1,
    visibleItemCount: 3,
  });
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    if (quest) useStore.getState().upsertQuestDetail(quest, { etag: '"fork"' });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: threadKey,
      entries: sync.entries,
      window: sync.window,
    });
  });
}

const STARTED_FROM = { sessionId: SESSION_ID, messageId: "main-ask", threadKey: "main", timestamp: SENT_AT };
const HANDED_OFF_MESSAGE = {
  id: "main-ask",
  metadata: {
    threadKey: "main",
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
  },
};

describe("Started from link", () => {
  it("opens the quest thread with a link to the user's message it was filed from", () => {
    // The thread so far holds only the leader's dispatch; the link sits above the quest card.
    installThread(QUEST_ID, [], {
      id: "fork-quest",
      questId: QUEST_ID,
      version: 1,
      title: "Relay timeout",
      tldr: "Fix the relay timeout.",
      status: "refined",
      description: "Fix the relay timeout.",
      createdAt: 1,
      relationships: { startedFrom: STARTED_FROM },
    } as QuestmasterTask);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const link = screen.getByTestId("started-from-link");
    expect(link).toHaveTextContent("Started from your message in Main · 11:51 AM");
    expect(link.compareDocumentPosition(screen.getByTestId("quest-description-summary"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(link);
    expect(window.location.hash).toContain("/msg/main-ask");
    expect(window.location.hash).toContain("thread=main");
  });
});

describe("Continued in links", () => {
  it("adds a link under a handed-off message to the quest it moved into", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ quests: [{ questId: QUEST_ID, title: "Relay timeout", startedFrom: STARTED_FROM }] }),
      ),
    );
    installThread("main", HANDED_OFF_HISTORY);
    const onSelectThread = vi.fn();
    render(
      <StartedQuestsProvider sessionId={SESSION_ID} enabled refreshKey="main">
        <MessageFeed sessionId={SESSION_ID} threadKey="main" onSelectThread={onSelectThread} />
      </StartedQuestsProvider>,
    );

    const bubble = screen.getByTestId("user-message-bubble");
    await waitFor(() =>
      expect(within(bubble).getByTestId("continued-in-link")).toHaveTextContent("Continued in Relay timeout"),
    );
    fireEvent.click(within(bubble).getByTestId("continued-in-link"));
    expect(onSelectThread).toHaveBeenCalledWith(QUEST_ID);
  });

  it("leaves the link out in the quest's own thread, where the message may also show", async () => {
    // A handed-off message shows in both threads; in the quest itself the link would point to itself.
    const value = { questId: QUEST_ID, title: "Relay timeout", startedFrom: STARTED_FROM };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ quests: [value] })),
    );
    render(
      <StartedQuestsProvider sessionId={SESSION_ID} enabled refreshKey="q-9">
        <div data-testid="in-main">
          <ContinuedInLinks message={HANDED_OFF_MESSAGE} currentThreadKey="main" onSelectThread={vi.fn()} />
        </div>
        <div data-testid="in-quest">
          <ContinuedInLinks message={HANDED_OFF_MESSAGE} currentThreadKey={QUEST_ID} onSelectThread={vi.fn()} />
        </div>
      </StartedQuestsProvider>,
    );
    await waitFor(() => expect(within(screen.getByTestId("in-main")).getByTestId("continued-in-link")).toBeVisible());
    expect(within(screen.getByTestId("in-quest")).queryByTestId("continued-in-links")).not.toBeInTheDocument();
  });
  it("shows a supporting quest's phase under the request and previews it instead of switching tabs", async () => {
    // q-9 supports the Main request, which stays in Main and is answered there; q-10 already finished.
    const supporting = (questId: string, title: string) => ({ questId, title, startedFrom: STARTED_FROM });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ quests: [supporting(QUEST_ID, "Relay timeout"), supporting("q-10", "Relay logs")] }),
      ),
    );
    act(() =>
      useStore.setState((state) => ({
        sessionBoards: new Map(state.sessionBoards).set(SESSION_ID, [
          { questId: QUEST_ID, status: "WORKING", updatedAt: 1 },
        ]),
        sessionCompletedBoards: new Map(state.sessionCompletedBoards).set(SESSION_ID, [
          { questId: "q-10", status: "COMPLETED", updatedAt: 2 },
        ]),
      })),
    );
    const onSelectThread = vi.fn();
    render(
      <StartedQuestsProvider sessionId={SESSION_ID} enabled refreshKey="main">
        <ContinuedInLinks message={{ id: "main-ask" }} currentThreadKey="main" onSelectThread={onSelectThread} />
      </StartedQuestsProvider>,
    );

    await waitFor(() => expect(screen.getAllByTestId("supporting-quest-link")).toHaveLength(2));
    const [running, done] = screen.getAllByTestId("supporting-quest-link");
    expect(running).toHaveTextContent("Work · Relay timeout");
    expect(done).toHaveTextContent("Done · Relay logs");
    expect(screen.queryByTestId("continued-in-link")).not.toBeInTheDocument();
    fireEvent.click(within(running).getByText("Relay timeout"));
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("turns a supporting row into Continued in when the request is handed off after the quests loaded", async () => {
    // The leader files q-9 and moves the request into it moments later. The started quests
    // load when q-9's thread appears, before the handoff, and are not loaded again; the
    // updated message alone must switch the row.
    const fetchMock = vi.fn(async () =>
      Response.json({ quests: [{ questId: QUEST_ID, title: "Relay timeout", startedFrom: STARTED_FROM }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    act(() =>
      useStore.setState((state) => ({
        sessionBoards: new Map(state.sessionBoards).set(SESSION_ID, [
          { questId: QUEST_ID, status: "WORKING", updatedAt: 1 },
        ]),
      })),
    );
    installThread("main", HISTORY);
    render(
      <StartedQuestsProvider sessionId={SESSION_ID} enabled refreshKey="main">
        <MessageFeed sessionId={SESSION_ID} threadKey="main" onSelectThread={vi.fn()} />
      </StartedQuestsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("supporting-quest-link")).toHaveTextContent("Work · Relay timeout"));

    installThread("main", HANDED_OFF_HISTORY);

    expect(screen.getByTestId("continued-in-link")).toHaveTextContent("Continued in Relay timeout");
    expect(screen.queryByTestId("supporting-quest-link")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
