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
  it("adds a link under the source message to each quest it started", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ quests: [{ questId: QUEST_ID, title: "Relay timeout", startedFrom: STARTED_FROM }] }),
      ),
    );
    installThread("main", HISTORY);
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
          <ContinuedInLinks messageId="main-ask" currentThreadKey="main" onSelectThread={vi.fn()} />
        </div>
        <div data-testid="in-quest">
          <ContinuedInLinks messageId="main-ask" currentThreadKey={QUEST_ID} onSelectThread={vi.fn()} />
        </div>
      </StartedQuestsProvider>,
    );
    await waitFor(() => expect(within(screen.getByTestId("in-main")).getByTestId("continued-in-link")).toBeVisible());
    expect(within(screen.getByTestId("in-quest")).queryByTestId("continued-in-links")).not.toBeInTheDocument();
  });
});
