// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadTabsProjectionTab } from "../../shared/leader-thread-tabs-projection.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";

const mockMarkNotificationDone = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("./ViewportHandoffEntryGate.js", () => ({
  ViewportHandoffThreadEntryGate: ({ children }: any) => children,
  ViewportHandoffSessionEntryGate: ({ children }: any) => children,
}));
vi.mock("../utils/viewport-handoff-client.js", () => ({
  createViewportHandoffEntryId: () => "test-viewport-entry",
  noteViewportSelectionActivity: vi.fn(),
}));
const mockSendToSession = vi.hoisted(() => vi.fn((_sessionId: string, _message: unknown) => true));
vi.mock("../ws.js", () => ({ connectSession: vi.fn(), sendToSession: mockSendToSession }));
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
const feedThreadSelection = vi.hoisted(() => ({ select: null as null | ((threadKey: string) => void) }));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({ threadKey, onSelectThread }: { threadKey: string; onSelectThread?: (key: string) => void }) => {
    feedThreadSelection.select = onSelectThread ?? null;
    return <div data-testid="message-feed" data-thread-key={threadKey} />;
  },
}));
vi.mock("./WorkBoardBar.js", () => ({ WorkBoardBar: () => null }));

import { useStore } from "../store.js";
import { openAttentionItem } from "../hooks/useNextAttention.js";
import { threadRouteFromHash } from "../utils/routing.js";
import { CLOSE_THREAD_TAB_EVENT } from "../utils/attention-item-menu.js";
import { ChatView } from "./ChatView.js";
import { THREAD_READ_DWELL_MS } from "../hooks/use-thread-read-on-screen.js";

const NO_ATTENTION = { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 };

function questTab(threadKey: string): LeaderThreadTabsProjectionTab {
  return {
    threadKey,
    questId: threadKey,
    title: `Quest ${threadKey}`,
    boardStatus: "WORKING",
    journey: null,
    sourceLeaderSessionId: null,
    sourceRowCreatedAt: null,
    workerSessionId: null,
    workerSessionNum: null,
    ownership: "own",
    active: true,
    queued: false,
    proposed: false,
    neverStartedScheduled: false,
    completed: false,
    canClose: false,
    attention: NO_ATTENTION,
    updatedAt: 10,
    groupChangedAt: 10,
  } as LeaderThreadTabsProjectionTab;
}

/** Render ChatView for the route the hash currently holds, the way App derives its props. */
function routeProps() {
  const route = threadRouteFromHash(window.location.hash);
  return { hasThreadRoute: route.hasThreadParam, routeThreadKey: route.threadKey ?? undefined };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  window.location.hash = "#/session/leader?thread=q-1";
  mockMarkNotificationDone.mockClear();
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
    sessionNotifications: new Map([
      [
        "leader",
        [
          {
            id: "n-main",
            category: "review",
            summary: "Thread ready: main | done",
            timestamp: 20,
            messageId: "m-main",
            threadKey: "main",
            done: false,
          },
        ],
      ],
    ]),
  });
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      value: createLeaderThreadTabsProjectionValue({
        tabState: { version: 1, orderedOpenThreadKeys: ["q-1"], closedThreadTombstones: [], updatedAt: 10 },
        tabs: [questTab("q-1")],
        mainAttention: { ...NO_ATTENTION, reviewUnread: true, updatedAt: 20 },
        threadStatuses: {},
        activePhaseSummary: [],
      }),
    }),
  );
});

describe("ChatView attention navigation", () => {
  it("selects Main and clears its unread result when an attention item opens it from a quest thread", async () => {
    // Reproduces the reported bug: from a quest tab, opening Main's unread
    // result through the attention chip (or Next) left the quest tab selected,
    // so Main's review notification was never cleared.
    const view = render(<ChatView sessionId="leader" {...routeProps()} />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1"));
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();

    act(() => {
      openAttentionItem(
        {
          kind: "unread",
          key: "unread:leader:main",
          sessionId: "leader",
          threadKey: "main",
          label: "Main",
          timestamp: 20,
        },
        useStore.getState().sdkSessions,
      );
    });
    view.rerender(<ChatView sessionId="leader" {...routeProps()} />);

    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    await waitFor(() => expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-main", true), {
      timeout: THREAD_READ_DWELL_MS + 1_000,
    });
    view.unmount();
  });

  it("opens a thread chosen in the view like any opening, even with unread results", async () => {
    // Choosing a tab (or an in-feed thread link) no longer jumps to its oldest unread result: the
    // thread opens where it was left if recent, else at its latest messages with the unread ones
    // counted above (the feed decides). Next and notifications still land on the message.
    useStore.getState().setSessionNotifications("leader", [
      {
        id: "n-main",
        category: "review",
        summary: "Later",
        timestamp: 20,
        messageId: "m-later",
        threadKey: "main",
        done: false,
      },
      {
        id: "n-first",
        category: "review",
        summary: "First",
        timestamp: 15,
        messageId: "m-first",
        threadKey: "main",
        done: false,
      },
    ] as never);
    const view = render(<ChatView sessionId="leader" {...routeProps()} />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1"));

    act(() => feedThreadSelection.select?.("main"));
    // The selection is local, so Main needs no explicit thread in the address.
    expect(window.location.hash).toBe("#/session/leader");
    expect(useStore.getState().scrollToMessageId.get("leader")).toBeUndefined();

    act(() => feedThreadSelection.select?.("q-1"));
    expect(window.location.hash).toBe("#/session/leader?thread=q-1");
    view.unmount();
  });

  it("selects Main when no Ready result message is known for it", async () => {
    // Without a result to scroll to, the item opens the thread itself; Main
    // must still be an explicit route or the quest tab is restored.
    useStore
      .getState()
      .setSessionNotifications("leader", [
        { id: "n-main", category: "review", summary: "Thread ready", timestamp: 20, threadKey: "main", done: false },
      ] as never);
    const view = render(<ChatView sessionId="leader" {...routeProps()} />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1"));

    act(() => {
      openAttentionItem(
        {
          kind: "unread",
          key: "unread:leader:main",
          sessionId: "leader",
          threadKey: "main",
          label: "Main",
          timestamp: 20,
        },
        useStore.getState().sdkSessions,
      );
    });
    expect(window.location.hash).toContain("thread=main");
    view.rerender(<ChatView sessionId="leader" {...routeProps()} />);

    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    await waitFor(() => expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-main", true), {
      timeout: THREAD_READ_DWELL_MS + 1_000,
    });
    view.unmount();
  });

  it("closes one of its tabs when an attention list asks, through the tab close path", async () => {
    // Attention-row menus offer Close tab for the session on screen; ChatView
    // handles it like the tab's own close button.
    const view = render(<ChatView sessionId="leader" {...routeProps()} />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CLOSE_THREAD_TAB_EVENT, { detail: { sessionId: "leader", threadKey: "q-1" } }),
      );
    });
    expect(mockSendToSession).toHaveBeenCalledWith(
      "leader",
      expect.objectContaining({
        type: "leader_thread_tabs_update",
        operation: expect.objectContaining({ type: "close", threadKey: "q-1" }),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    view.unmount();
  });

  it("moves straight to the next item's thread when the chip closes the selected tab and goes on", async () => {
    // The feed chip's "Close tab and go to next" closes the tab with the next
    // item's thread, then opens the item there. The view must end on that
    // thread, not on Main (the default after closing the selected tab).
    const view = render(<ChatView sessionId="leader" {...routeProps()} />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CLOSE_THREAD_TAB_EVENT, {
          detail: { sessionId: "leader", threadKey: "q-1", nextThreadKey: "q-2" },
        }),
      );
      openAttentionItem(
        {
          kind: "needs-input",
          entry: {
            sessionId: "leader",
            sessionName: "Leader",
            sessionNum: 1,
            notification: {
              id: "n-2",
              category: "needs-input",
              summary: "Pick one",
              timestamp: 30,
              messageId: "m-2",
              threadKey: "q-2",
              questId: "q-2",
              done: false,
            },
          },
          key: "needs-input:leader:n-2",
          sessionId: "leader",
          threadKey: "q-2",
          label: "Pick one",
          timestamp: 30,
        },
        useStore.getState().sdkSessions,
      );
    });
    expect(mockSendToSession).toHaveBeenCalledWith(
      "leader",
      expect.objectContaining({ operation: expect.objectContaining({ type: "close", threadKey: "q-1" }) }),
    );
    expect(window.location.hash).toContain("thread=q-2");
    view.rerender(<ChatView sessionId="leader" {...routeProps()} />);

    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-2"));
    view.unmount();
  });
});
