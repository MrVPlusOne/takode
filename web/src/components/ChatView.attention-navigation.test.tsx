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

import { useStore } from "../store.js";
import { openAttentionItem } from "../hooks/useNextAttention.js";
import { threadRouteFromHash } from "../utils/routing.js";
import { ChatView } from "./ChatView.js";

const NO_ATTENTION = { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 };

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
    await waitFor(() => expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-main", true));
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
    await waitFor(() => expect(mockMarkNotificationDone).toHaveBeenCalledWith("leader", "n-main", true));
    view.unmount();
  });
});
