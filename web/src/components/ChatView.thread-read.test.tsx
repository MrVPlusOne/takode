// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadTabsProjectionTab } from "../../shared/leader-thread-tabs-projection.js";
import type { SessionNotification } from "../types.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";

// A thread's Ready result counts as read only once the user has really looked at
// that thread: its session is the one shown, the thread is selected, and the page
// has been visible for a short dwell. Returning to a leader once restored its saved
// tab for about a second before settling on Main, which marked that tab's result
// read and sent it straight to Done although the user never saw it.

const mockMarkNotificationDone = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("./ViewportHandoffEntryGate.js", () => ({
  ViewportHandoffThreadEntryGate: ({ children }: any) => children,
  ViewportHandoffSessionEntryGate: ({ children }: any) => children,
}));
vi.mock("../utils/viewport-handoff-client.js", () => ({
  createViewportHandoffEntryId: () => "test-viewport-entry",
  noteViewportSelectionActivity: vi.fn(),
}));
vi.mock("../ws.js", () => ({ connectSession: vi.fn(), sendToSession: vi.fn(() => true) }));
vi.mock("../api.js", () => ({
  api: {
    getQuestTitles: vi.fn().mockResolvedValue({ quests: [], missingQuestIds: [] }),
    markNotificationDone: mockMarkNotificationDone,
    markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
    relaunchSession: vi.fn().mockResolvedValue({ ok: true }),
    unarchiveSession: vi.fn().mockResolvedValue({ ok: true }),
    acknowledgeModelProvenanceMigration: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock("../hooks/useSessionSearch.js", () => ({ useSessionSearch: vi.fn() }));
vi.mock("./SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./Composer.js", () => ({ Composer: () => null }));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({ threadKey }: { threadKey: string }) => <div data-testid="message-feed" data-thread-key={threadKey} />,
}));
vi.mock("./WorkBoardBar.js", () => ({ WorkBoardBar: () => null }));
const mockRecordViewedTab = vi.hoisted(() => vi.fn());
vi.mock("../utils/view-history.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/view-history.js")>()),
  recordViewedTab: mockRecordViewedTab,
}));

import { useStore } from "../store.js";
import { threadRouteFromHash } from "../utils/routing.js";
import { ChatView } from "./ChatView.js";
import { THREAD_READ_DWELL_MS } from "../hooks/use-thread-read-on-screen.js";
import { KeptConversationViews } from "./KeptConversationViews.js";
import { readDisplayedLeaderThreadKey } from "../utils/thread-viewport.js";

const NO_ATTENTION = { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 };
let visibility: DocumentVisibilityState = "visible";

function questTab(threadKey: string): LeaderThreadTabsProjectionTab {
  return {
    threadKey,
    questId: threadKey,
    title: `Quest ${threadKey}`,
    boardStatus: "DONE",
    journey: null,
    sourceLeaderSessionId: null,
    sourceRowCreatedAt: null,
    workerSessionId: null,
    workerSessionNum: null,
    ownership: "own",
    active: false,
    queued: false,
    proposed: false,
    neverStartedScheduled: false,
    completed: true,
    canClose: true,
    attention: { ...NO_ATTENTION, reviewUnread: true, updatedAt: 20 },
    updatedAt: 10,
    groupChangedAt: 10,
  } as LeaderThreadTabsProjectionTab;
}

function review(id: string, fields: Partial<SessionNotification>): SessionNotification {
  return { id, category: "review", summary: "Thread ready", timestamp: 20, messageId: null, done: false, ...fields };
}

function installLeader(notifications: SessionNotification[]) {
  useStore.getState().reset();
  useStore.setState({
    connectionStatus: new Map([["leader", "connected"]]),
    sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
    sessions: new Map([
      [
        "leader",
        {
          session_id: "leader",
          model: "test",
          cwd: "/repo",
          permissionMode: "default",
          backend_state: "connected",
          backend_error: null,
          isOrchestrator: true,
        } as never,
      ],
    ]),
    sessionNotifications: new Map([["leader", notifications]]),
  });
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      value: createLeaderThreadTabsProjectionValue({
        tabState: { version: 1, orderedOpenThreadKeys: ["q-1", "q-2"], closedThreadTombstones: [], updatedAt: 10 },
        tabs: [questTab("q-1"), questTab("q-2")],
        mainAttention: NO_ATTENTION,
        threadStatuses: {},
        activePhaseSummary: [],
      }),
    }),
  );
}

/** Render ChatView for the route the hash currently holds, the way App derives its props. */
function renderLeader(hash: string) {
  window.location.hash = hash;
  const props = () => {
    const route = threadRouteFromHash(window.location.hash);
    return { hasThreadRoute: route.hasThreadParam, routeThreadKey: route.threadKey ?? undefined };
  };
  const view = render(<ChatView sessionId="leader" {...props()} />);
  return {
    navigate(nextHash: string) {
      window.location.hash = nextHash;
      view.rerender(<ChatView sessionId="leader" {...props()} />);
    },
  };
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  mockMarkNotificationDone.mockClear();
  mockRecordViewedTab.mockClear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatView marking Ready results read", () => {
  it("marks the selected thread's result read once it has been on screen for the dwell", () => {
    installLeader([review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    renderLeader("#/session/leader?thread=q-1");
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1");

    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS - 100));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-q1", true);
  });

  it("leaves a tab's result unread when a returning session shows that tab only briefly before Main", () => {
    // The reported sequence: back in the leader, its saved q-1 tab showed for about
    // a second, then the view settled on Main. The user never saw q-1's result.
    installLeader([review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    const view = renderLeader("#/session/leader?thread=q-1");

    act(() => vi.advanceTimersByTime(1_100));
    view.navigate("#/session/leader?thread=main");
    act(() => vi.advanceTimersByTime(10 * THREAD_READ_DWELL_MS));

    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main");
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();
  });

  it("does not mark a result read while the page is hidden, only after it has been visible for the dwell", () => {
    // A tab left selected while the app is in the background (or another app is in
    // front) has not been looked at when its quest finishes.
    installLeader([review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    visibility = "hidden";
    renderLeader("#/session/leader?thread=q-1");
    act(() => vi.advanceTimersByTime(10 * THREAD_READ_DWELL_MS));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();

    // Hidden again before the dwell ends: still unread.
    setVisibility("visible");
    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS / 2));
    setVisibility("hidden");
    act(() => vi.advanceTimersByTime(10 * THREAD_READ_DWELL_MS));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();

    setVisibility("visible");
    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS));
    expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-q1", true);
  });

  it("reads a result that arrives while its thread has already been on screen at once", () => {
    // Watching a tab when its quest finishes still files it straight into Done.
    installLeader([]);
    renderLeader("#/session/leader?thread=q-1");
    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS));

    act(() => {
      useStore.getState().setSessionNotifications("leader", [review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    });
    expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-q1", true);
  });

  it("clears a backing multi-quest review notification once a quest it names has been on screen", () => {
    installLeader([review("review-batch", { summary: "2 quests ready for review: q-1, q-2", threadKey: "main" })]);
    renderLeader("#/session/leader?thread=q-1");
    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS));
    expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "review-batch", true);
  });

  it("does not clear review notifications when aggregate All Threads is shown", () => {
    installLeader([review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    renderLeader("#/session/leader?thread=all");
    act(() => vi.advanceTimersByTime(10 * THREAD_READ_DWELL_MS));
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "all");
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();
  });

  it("does not clear another session's results from a session preview", () => {
    installLeader([review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    window.location.hash = "#/session/leader?thread=q-1";
    render(<ChatView sessionId="leader" preview hasThreadRoute routeThreadKey="q-1" />);
    act(() => vi.advanceTimersByTime(10 * THREAD_READ_DWELL_MS));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();
  });

  it("does not count a conversation kept mounted but hidden as viewed", () => {
    // Recently viewed conversations stay mounted, hidden, so going back is instant. Only the
    // one on screen is being viewed: a result arriving in a hidden leader's selected thread
    // stays unread, the leader is not recorded as viewed or as showing a thread, until the
    // user comes back and it has been on screen for the dwell.
    installLeader([]);
    window.location.hash = "#/session/leader?thread=q-1";
    const leaderView = <ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-1" />;
    const otherView = <div data-testid="other-conversation" />;
    const showing = (visibleSessionId: string) => (
      <KeptConversationViews
        conversations={[
          { sessionId: "leader", view: leaderView },
          { sessionId: "other", view: otherView },
        ]}
        visibleSessionId={visibleSessionId}
      />
    );
    const view = render(showing("leader"));
    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS));
    expect(readDisplayedLeaderThreadKey("leader")).toBe("q-1");
    expect(mockRecordViewedTab).toHaveBeenCalledWith("leader", "q-1");

    window.location.hash = "#/session/other";
    view.rerender(showing("other"));
    mockRecordViewedTab.mockClear();
    expect(screen.getByTestId("message-feed")).not.toBeVisible();
    expect(readDisplayedLeaderThreadKey("leader")).toBeNull();

    act(() => {
      useStore.getState().setSessionNotifications("leader", [review("n-q1", { threadKey: "q-1", questId: "q-1" })]);
    });
    act(() => vi.advanceTimersByTime(10 * THREAD_READ_DWELL_MS));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();
    expect(mockRecordViewedTab).not.toHaveBeenCalled();

    window.location.hash = "#/session/leader?thread=q-1";
    view.rerender(showing("leader"));
    expect(screen.getByTestId("message-feed")).toBeVisible();
    expect(readDisplayedLeaderThreadKey("leader")).toBe("q-1");
    act(() => vi.advanceTimersByTime(THREAD_READ_DWELL_MS - 100));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-q1", true);
  });
});
