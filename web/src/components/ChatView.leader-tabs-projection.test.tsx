// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadTabsProjectionTab } from "../../shared/leader-thread-tabs-projection.js";
import { SAVE_THREAD_VIEWPORT_EVENT, readLeaderSelectedThreadKey } from "../utils/thread-viewport.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";

const mockSendToSession = vi.hoisted(() => vi.fn(() => true));
const mockGetQuestTitles = vi.hoisted(() => vi.fn().mockResolvedValue({ quests: [], missingQuestIds: ["q-1"] }));

vi.mock("../ws.js", () => ({
  connectSession: vi.fn(),
  sendToSession: mockSendToSession,
}));
vi.mock("../api.js", () => ({
  api: {
    getQuestTitles: mockGetQuestTitles,
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    relaunchSession: vi.fn().mockResolvedValue({ ok: true }),
    unarchiveSession: vi.fn().mockResolvedValue({ ok: true }),
    acknowledgeModelProvenanceMigration: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock("../hooks/useSessionSearch.js", () => ({ useSessionSearch: vi.fn() }));
vi.mock("./SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./Composer.js", () => ({
  Composer: ({ threadKey }: { threadKey: string }) => <div data-testid="composer" data-thread-key={threadKey} />,
}));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({
    sessionId,
    threadKey,
    projectThreadRoutes,
  }: {
    sessionId: string;
    threadKey: string;
    projectThreadRoutes?: boolean;
  }) => (
    <div
      data-testid="message-feed"
      data-session-id={sessionId}
      data-thread-key={threadKey}
      data-project-thread-routes={projectThreadRoutes ? "true" : "false"}
    />
  ),
}));
vi.mock("./WorkBoardBar.js", () => ({
  WorkBoardBar: ({
    currentThreadKey,
    openThreadKeys,
    threadRows,
    onSelectThread,
  }: {
    currentThreadKey: string;
    openThreadKeys?: string[];
    threadRows?: Array<{ threadKey: string; title: string }>;
    onSelectThread?: (threadKey: string) => void;
  }) => (
    <div
      data-testid="work-board-bar"
      data-current-thread-key={currentThreadKey}
      data-open-thread-keys={(openThreadKeys ?? []).join(",")}
      data-thread-titles={(threadRows ?? []).map((row) => `${row.threadKey}:${row.title}`).join("|")}
      data-has-thread-navigation={onSelectThread ? "true" : "false"}
    />
  ),
}));

import { useStore } from "../store.js";
import { ChatView } from "./ChatView.js";

function projectedTab(title: string, updatedAt: number): LeaderThreadTabsProjectionTab {
  return {
    threadKey: "q-1",
    questId: "q-1",
    title,
    boardStatus: "WORKING",
    journey: { mode: "active", currentPhaseId: "work", activePhaseIndex: 1, phaseCount: 3 },
    active: true,
    queued: false,
    proposed: false,
    completed: false,
    canClose: false,
    attention: { needsInput: true, mutedNeedsInput: false, reviewUnread: false, updatedAt },
    updatedAt,
  };
}

function projectionValue(title: string, updatedAt: number, orderedOpenThreadKeys: string[] = ["q-1", "q-2"]) {
  const q1 = projectedTab(title, updatedAt);
  const q2: LeaderThreadTabsProjectionTab = {
    ...projectedTab("Projected q-2", updatedAt),
    threadKey: "q-2",
    questId: "q-2",
    completed: true,
    active: false,
    boardStatus: "DONE",
    canClose: true,
    attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
  };
  const tabsByKey = new Map([
    ["q-1", q1],
    ["q-2", q2],
  ]);
  return createLeaderThreadTabsProjectionValue({
    tabState: {
      version: 1,
      orderedOpenThreadKeys,
      closedThreadTombstones: [],
      updatedAt,
    },
    tabs: orderedOpenThreadKeys.map((threadKey) => tabsByKey.get(threadKey)!),
    mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    threadStatuses: {},
    activePhaseSummary: [{ label: "Work", count: 1, tone: "phase" }],
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  window.location.hash = "#/session/leader?thread=q-1";
  mockSendToSession.mockClear();
  mockGetQuestTitles.mockClear();
  useStore.getState().reset();
  useStore.setState({
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
          leaderOpenThreadTabs: {
            version: 1,
            orderedOpenThreadKeys: ["q-stale"],
            closedThreadTombstones: [],
            updatedAt: 1,
          },
        } as never,
      ],
    ]),
    sessionBoards: new Map([
      [
        "leader",
        [
          {
            questId: "q-1",
            title: "Matching board title",
            status: "WORKING",
            createdAt: 10,
            updatedAt: 10,
            waitForInput: ["n-1"],
          },
        ],
      ],
    ]),
    sessionNotifications: new Map([
      [
        "leader",
        [
          {
            id: "n-1",
            category: "needs-input",
            summary: "Confirm q-1",
            timestamp: 10,
            messageId: null,
            threadKey: "q-1",
            questId: "q-1",
            done: false,
          },
        ],
      ],
    ]),
    messages: new Map([
      ["leader", [{ id: "main-message", role: "assistant", content: "Main remains selected", timestamp: 1 }]],
    ]),
  });
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      value: projectionValue("Projected q-1", 10),
    }),
  );
});

describe("ChatView leader thread tabs projection", () => {
  it("does not feed authoritative projection refreshes back into tab commands or navigation", async () => {
    const viewportSnapshots: string[] = [];
    const onViewportSnapshot = (event: Event) => {
      viewportSnapshots.push((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId ?? "");
    };
    window.addEventListener(SAVE_THREAD_VIEWPORT_EVENT, onViewportSnapshot);

    const view = render(<ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-1" />);
    try {
      await waitFor(() =>
        expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1,q-2"),
      );
      expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1");
      expect(window.location.hash).toBe("#/session/leader?thread=q-1");
      const selectedThreadBeforeRefresh = readLeaderSelectedThreadKey("leader");
      expect(selectedThreadBeforeRefresh).toBe("q-1");

      mockSendToSession.mockClear();
      viewportSnapshots.length = 0;
      act(() => {
        useStore.getState().applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({
            type: "synced_projection_update",
            key: "leader",
            revision: 2,
            value: projectionValue("Refreshed projected q-1", 20, ["q-2", "q-1"]),
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-2,q-1");
        expect(screen.getByTestId("work-board-bar")).toHaveAttribute(
          "data-thread-titles",
          expect.stringContaining("q-1:Refreshed projected q-1"),
        );
      });

      act(() => {
        useStore.getState().applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({
            type: "synced_projection_update",
            key: "leader",
            revision: 3,
            value: projectionValue("Refreshed projected q-1", 30, ["q-1"]),
          }),
        );
      });
      await waitFor(() => expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1"));

      const sentMessages = mockSendToSession.mock.calls as unknown as Array<[string, { type?: string }]>;
      expect(sentMessages.filter(([, message]) => message.type === "leader_thread_tabs_update")).toEqual([]);
      expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1");
      expect(screen.getByTestId("composer")).toHaveAttribute("data-thread-key", "q-1");
      expect(window.location.hash).toBe("#/session/leader?thread=q-1");
      expect(readLeaderSelectedThreadKey("leader")).toBe(selectedThreadBeforeRefresh);
      expect(viewportSnapshots).toEqual([]);
    } finally {
      window.removeEventListener(SAVE_THREAD_VIEWPORT_EVENT, onViewportSnapshot);
      view.unmount();
    }
  });

  it("migrates local tabs when an accepted projection has derived tabs but no durable tab state", async () => {
    useStore.getState().reset();
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:leader", '["q-local","q-1"]');
    window.location.hash = "#/session/leader";
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: true,
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-stale"],
              closedThreadTombstones: [],
              updatedAt: 1,
            },
          } as never,
        ],
      ]),
      messages: new Map([
        [
          "leader",
          [
            {
              id: "local-thread",
              role: "assistant",
              content: "Local retained thread",
              timestamp: 1,
              metadata: { threadRefs: [{ threadKey: "q-local", questId: "q-local", source: "explicit" }] },
            },
          ],
        ],
      ]),
      quests: [{ questId: "q-local", title: "Locally retained tab", status: "in_progress" } as never],
    });
    const value = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [projectedTab("Server-derived tab", 20)],
      threadStatuses: {},
      activePhaseSummary: [],
    });
    useStore
      .getState()
      .applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "leader", value }));
    mockSendToSession.mockClear();

    render(<ChatView sessionId="leader" />);

    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-local,q-1");
    await waitFor(() =>
      expect(mockSendToSession).toHaveBeenCalledWith("leader", {
        type: "leader_thread_tabs_update",
        operation: {
          type: "migrate",
          orderedOpenThreadKeys: ["q-local", "q-1"],
          migratedAt: expect.any(Number),
        },
      }),
    );
  });

  it("does not treat a malformed supplied projection as leader-role authority", () => {
    useStore.getState().reset();
    window.location.hash = "#/session/leader?thread=q-stale";
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader",
          archived: false,
          isOrchestrator: false,
          leaderThreadTabsProjection: { malformed: true },
        } as never,
      ],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: false,
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-stale"],
              closedThreadTombstones: [],
              updatedAt: 1,
            },
          } as never,
        ],
      ]),
      messages: new Map([["leader", [{ id: "main", role: "assistant", content: "Main", timestamp: 1 }]]]),
    });

    render(<ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-stale" />);

    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main");
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-project-thread-routes", "false");
    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "");
    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-has-thread-navigation", "false");
  });
});
