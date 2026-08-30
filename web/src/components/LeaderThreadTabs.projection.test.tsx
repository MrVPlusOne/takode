// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeaderThreadTabsProjectionTab,
  LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import type { ChatMessage } from "../types.js";
import { useCollapsePolicy } from "../hooks/use-collapse-policy.js";
import { buildFeedModel } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { MessageFeed } from "./MessageFeed.js";
import { WorkBoardBar } from "./WorkBoardBar.js";

const mockSendToSession = vi.hoisted(() => vi.fn(() => true));

vi.mock("../ws.js", () => ({ sendToSession: mockSendToSession }));

vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn().mockResolvedValue({ status: "missing", data: null, etag: null }),
    markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
    markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

function installLeaderProjection(value: LeaderThreadTabsProjectionValue): void {
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
          leaderThreadStatuses: {
            "q-2": {
              kind: "ready",
              label: "Thread Ready",
              threadKey: "q-2",
              questId: "q-2",
              summary: "stale legacy status",
              messageId: "legacy-status",
              timestamp: 1,
              updatedAt: 1,
            },
          },
        } as never,
      ],
    ]),
  });
  useStore.getState().applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "leader", value }));
}

function setMeasuredRailWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 24,
      width,
      height: 24,
      toJSON: () => ({}),
    } as DOMRect;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

function projectedTab(
  threadKey: string,
  overrides: Partial<LeaderThreadTabsProjectionTab> = {},
): LeaderThreadTabsProjectionTab {
  const { attention, ...rest } = overrides;
  return {
    threadKey,
    questId: threadKey,
    title: `Projected ${threadKey}`,
    boardStatus: null,
    journey: null,
    sourceLeaderSessionId: null,
    sourceRowCreatedAt: null,
    workerSessionId: null,
    workerSessionNum: null,
    active: false,
    queued: false,
    proposed: false,
    completed: false,
    canClose: true,
    updatedAt: 10,
    ...rest,
    attention: {
      needsInput: false,
      mutedNeedsInput: false,
      reviewUnread: false,
      updatedAt: 0,
      ...attention,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useStore.getState().reset();
});

describe("leader thread tabs projected component behavior", () => {
  it("renders projected attention and preserves the completed Waiting foreground rule", async () => {
    const value = createLeaderThreadTabsProjectionValue();
    value.tabs[1] = {
      ...value.tabs[1]!,
      attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    };
    installLeaderProjection(value);

    render(
      <WorkBoardBar
        sessionId="leader"
        currentThreadKey="main"
        openThreadKeys={["q-stale"]}
        threadRows={[{ threadKey: "q-stale", questId: "q-stale", title: "Stale legacy tab", messageCount: 1 }]}
      />,
    );

    const tabs = screen.getAllByTestId("thread-tab");
    expect(tabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1", "q-2"]);
    const q1 = tabs[0]!;
    const q2 = tabs[1]!;
    expect(q1).toHaveAttribute("data-needs-input", "true");
    expect(within(q1).getByTestId("thread-tab-needs-input-bell")).toBeTruthy();
    expect(within(q2).getByTestId("thread-tab-title")).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(screen.queryByText("Stale legacy tab")).toBeNull();

    const ready = createLeaderThreadTabsProjectionValue({
      tabs: value.tabs,
      threadStatuses: {
        ...value.threadStatuses,
        "q-2": {
          kind: "ready",
          label: "Thread Ready",
          threadKey: "q-2",
          questId: "q-2",
          summary: "validation complete",
          messageId: "q-2-ready",
          timestamp: 120,
          updatedAt: 120,
        },
      },
    });
    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        createLeaderThreadTabsProjectionEnvelope({
          type: "synced_projection_update",
          key: "leader",
          revision: 2,
          value: ready,
        }),
      );
    });

    await waitFor(() =>
      expect(within(q2).getByTestId("thread-tab-title")).toHaveAttribute("data-title-color", "var(--color-cc-muted)"),
    );
  });

  it("keeps active Work color and completed Waiting foreground in hidden More rows", async () => {
    setMeasuredRailWidth(392);
    const tabs = [
      projectedTab("q-1", { active: true, canClose: false }),
      projectedTab("q-2", { active: true, canClose: false }),
      projectedTab("q-3", {
        completed: true,
        boardStatus: "MEMORY",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "memory",
          activePhaseIndex: 2,
          phaseCount: 3,
        },
      }),
      projectedTab("q-4", {
        active: true,
        completed: false,
        boardStatus: "WORKING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
          phaseCount: 3,
        },
        canClose: false,
      }),
      projectedTab("q-5"),
    ];
    installLeaderProjection(
      createLeaderThreadTabsProjectionValue({
        tabState: {
          version: 1,
          orderedOpenThreadKeys: tabs.map((tab) => tab.threadKey),
          closedThreadTombstones: [],
          updatedAt: 100,
        },
        tabs,
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        threadStatuses: {
          "q-3": {
            kind: "waiting",
            label: "Thread Waiting",
            threadKey: "q-3",
            questId: "q-3",
            summary: "waiting for final user review after completion",
            messageId: "q-3-waiting",
            timestamp: 100,
            updatedAt: 100,
          },
          "q-4": {
            kind: "waiting",
            label: "Thread Waiting",
            threadKey: "q-4",
            questId: "q-4",
            summary: "waiting on final verification",
            messageId: "q-4-waiting",
            timestamp: 100,
            updatedAt: 100,
          },
        },
        activePhaseSummary: [],
      }),
    );
    useStore.setState({
      quests: [
        {
          id: "q-4",
          questId: "q-4",
          title: "Stale hydrated completion",
          status: "done",
          description: "",
          createdAt: 1,
          completedAt: 90,
          verificationItems: [],
        } as never,
      ],
    });

    render(
      <WorkBoardBar
        sessionId="leader"
        currentThreadKey="q-5"
        openThreadKeys={["q-stale"]}
        onCloseThreadTab={vi.fn()}
        threadRows={[{ threadKey: "q-4", questId: "q-4", title: "Archived q-4", messageCount: 1, section: "done" }]}
      />,
    );

    const moreButton = await screen.findByTestId("thread-tabs-more-button");
    expect(moreButton).toHaveAttribute("data-has-needs-input", "false");
    expect(moreButton).toHaveAttribute("data-has-blue-notification", "false");
    fireEvent.click(moreButton);
    const hiddenRows = screen.getAllByTestId("thread-tabs-more-row");
    const completedRow = hiddenRows.find((row) => row.getAttribute("data-thread-key") === "q-3")!;
    const activeWorkRow = hiddenRows.find((row) => row.getAttribute("data-thread-key") === "q-4")!;

    expect(within(completedRow).getByTestId("thread-tabs-more-row-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-fg)",
    );
    fireEvent.mouseEnter(completedRow);
    expect(within(completedRow).getByTestId("thread-tabs-more-row-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-fg)",
    );
    expect(within(completedRow).getByRole("button", { name: "Close q-3" })).toBeTruthy();

    expect(within(activeWorkRow).getByTestId("thread-tabs-more-row-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-phase-thread-tab-title-work, #166534)",
    );
    fireEvent.mouseEnter(activeWorkRow);
    expect(within(activeWorkRow).getByTestId("thread-tabs-more-row-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-phase-thread-tab-title-work, #166534)",
    );
    expect(within(activeWorkRow).queryByRole("button", { name: "Close q-4" })).toBeNull();
  });

  it("uses accepted projected activity over stale hydrated completion and follows projected completion", async () => {
    const projected = projectedTab("q-700", {
      active: true,
      boardStatus: "WORKING",
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 1,
        phaseCount: 3,
      },
      canClose: false,
    });
    installLeaderProjection(
      createLeaderThreadTabsProjectionValue({
        tabState: {
          version: 1,
          orderedOpenThreadKeys: ["q-700"],
          closedThreadTombstones: [],
          updatedAt: 100,
        },
        tabs: [projected],
        mainAttention: {
          needsInput: false,
          mutedNeedsInput: false,
          reviewUnread: false,
          updatedAt: 0,
        },
        threadStatuses: {
          "q-700": {
            kind: "waiting",
            label: "Thread Waiting",
            threadKey: "q-700",
            questId: "q-700",
            summary: "waiting for final review",
            messageId: "q-700-waiting",
            timestamp: 100,
            updatedAt: 100,
          },
        },
        activePhaseSummary: [],
      }),
    );
    useStore.setState({
      quests: [
        {
          id: "q-700",
          questId: "q-700",
          title: "Hydrated completed quest",
          status: "done",
          description: "",
          tags: [],
          createdAt: 1,
          updatedAt: 100,
          statusChangedAt: 100,
          completedAt: 100,
          verificationItems: [],
        } as never,
      ],
    });

    render(<WorkBoardBar sessionId="leader" currentThreadKey="main" onCloseThreadTab={vi.fn()} />);

    const tab = screen.getByTestId("thread-tab");
    expect(tab).toHaveAttribute("data-thread-key", "q-700");
    expect(tab).toHaveAttribute("data-closable", "false");
    expect(within(tab).getByTestId("thread-tab-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-phase-thread-tab-title-work, #166534)",
    );
    fireEvent.mouseEnter(tab);
    act(() => {
      useStore.getState().upsertQuestDetail({
        id: "q-700",
        questId: "q-700",
        version: 2,
        title: "Hydrated current quest",
        status: "in_progress",
        description: "",
        createdAt: 1,
        updatedAt: 110,
        statusChangedAt: 110,
        sessionId: "worker-current",
        claimedAt: 110,
      });
    });
    expect(within(tab).getByTestId("thread-tab-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-phase-thread-tab-title-work, #166534)",
    );
    expect(within(tab).queryByRole("button", { name: "Close q-700" })).toBeNull();

    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        createLeaderThreadTabsProjectionEnvelope({
          type: "synced_projection_update",
          key: "leader",
          revision: 2,
          value: createLeaderThreadTabsProjectionValue({
            tabState: {
              version: 1,
              orderedOpenThreadKeys: ["q-700"],
              closedThreadTombstones: [],
              updatedAt: 120,
            },
            tabs: [
              {
                ...projected,
                active: false,
                completed: true,
                canClose: true,
                updatedAt: 120,
              },
            ],
            mainAttention: {
              needsInput: false,
              mutedNeedsInput: false,
              reviewUnread: false,
              updatedAt: 0,
            },
            threadStatuses: {
              "q-700": {
                kind: "ready",
                label: "Thread Ready",
                threadKey: "q-700",
                questId: "q-700",
                summary: "review complete",
                messageId: "q-700-ready",
                timestamp: 120,
                updatedAt: 120,
              },
            },
            activePhaseSummary: [],
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(tab).toHaveAttribute("data-closable", "true");
      expect(within(tab).getByTestId("thread-tab-title")).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
      expect(within(tab).getByRole("button", { name: "Close q-700" })).toBeTruthy();
    });
  });

  it("retains local completion fallback for legacy projection values", () => {
    const legacyTab = projectedTab("q-701", { active: true, canClose: false });
    installLeaderProjection(
      createLeaderThreadTabsProjectionValue({
        currentQuestStateVersion: null,
        tabState: {
          version: 1,
          orderedOpenThreadKeys: ["q-701"],
          closedThreadTombstones: [],
          updatedAt: 10,
        },
        tabs: [legacyTab],
        threadStatuses: {},
      }),
    );
    useStore.setState({ quests: [{ questId: "q-701", title: "Legacy done", status: "done" } as never] });

    render(<WorkBoardBar sessionId="leader" currentThreadKey="main" onCloseThreadTab={vi.fn()} />);

    const tab = screen.getByTestId("thread-tab");
    expect(tab).toHaveAttribute("data-closable", "true");
    expect(within(tab).getByTestId("thread-tab-title")).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
  });

  it("combines restored local tabs with derived projection tabs while tab state is absent", () => {
    const shared = projectedTab("q-702", {
      attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: true, updatedAt: 30 },
    });
    const derived = projectedTab("q-703", {
      attention: { needsInput: false, mutedNeedsInput: true, reviewUnread: false, updatedAt: 20 },
    });
    installLeaderProjection(
      createLeaderThreadTabsProjectionValue({
        tabState: null,
        tabs: [shared, derived],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        threadStatuses: {},
        activePhaseSummary: [],
      }),
    );
    useStore.setState({
      quests: [
        { questId: "q-701", title: "Restored local", status: "in_progress" } as never,
        { questId: "q-702", title: "Shared canonical", status: "in_progress" } as never,
        { questId: "q-703", title: "Derived canonical", status: "in_progress" } as never,
      ],
    });

    render(<WorkBoardBar sessionId="leader" openThreadKeys={["q-701", "q-702"]} />);

    const tabs = screen.getAllByTestId("thread-tab");
    expect(tabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-701", "q-702", "q-703"]);
    expect(tabs[1]).toHaveAttribute("data-blue-notification", "true");
    expect(tabs[2]).toHaveAttribute("data-muted-needs-input", "true");
  });

  it("does not render leader navigation from only a malformed supplied projection", () => {
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "not-leader",
          archived: false,
          isOrchestrator: false,
          leaderThreadTabsProjection: { malformed: true },
        } as never,
      ],
      sessions: new Map([["not-leader", { session_id: "not-leader", isOrchestrator: false } as never]]),
    });

    render(<WorkBoardBar sessionId="not-leader" />);

    expect(screen.queryByTestId("thread-tab-rail")).toBeNull();
  });

  it("bounds Work to Memory to Completed renders and suppresses an equal completion revision", () => {
    const work = createLeaderThreadTabsProjectionValue({
      tabs: [
        projectedTab("q-1", {
          title: "Current quest",
          boardStatus: "WORKING",
          journey: {
            mode: "active",
            phaseIds: ["alignment", "work", "memory"],
            currentPhaseId: "work",
            activePhaseIndex: 1,
            phaseCount: 3,
          },
          active: true,
          canClose: false,
          updatedAt: 100,
        }),
      ],
      tabState: {
        version: 1,
        orderedOpenThreadKeys: ["q-1"],
        closedThreadTombstones: [],
        updatedAt: 100,
      },
      threadStatuses: {},
      activePhaseSummary: [{ label: "Work", count: 1, tone: "phase", color: "blue", colorName: "Blue" }],
    });
    const memory = createLeaderThreadTabsProjectionValue({
      ...work,
      tabs: [
        {
          ...work.tabs[0]!,
          boardStatus: "MEMORY",
          journey: {
            ...work.tabs[0]!.journey!,
            currentPhaseId: "memory",
            activePhaseIndex: 2,
          },
          updatedAt: 110,
        },
      ],
      tabState: { ...work.tabState!, updatedAt: 110 },
      activePhaseSummary: [{ label: "Memory", count: 1, tone: "phase", color: "purple", colorName: "Purple" }],
    });
    const completed = createLeaderThreadTabsProjectionValue({
      ...memory,
      tabs: [
        {
          ...memory.tabs[0]!,
          boardStatus: "DONE",
          active: false,
          completed: true,
          canClose: true,
          updatedAt: 120,
        },
      ],
      tabState: { ...memory.tabState!, updatedAt: 120 },
      activePhaseSummary: [],
    });

    installLeaderProjection(work);
    const commits: Array<{ phase: Parameters<ProfilerOnRenderCallback>[1]; actualDuration: number }> = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
      commits.push({ phase, actualDuration });
    };
    render(
      <Profiler id="workboard-transition" onRender={onRender}>
        <WorkBoardBar sessionId="leader" />
      </Profiler>,
    );

    const commitsAfterMount = commits.length;
    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        createLeaderThreadTabsProjectionEnvelope({
          type: "synced_projection_update",
          key: "leader",
          revision: 2,
          value: memory,
        }),
      );
    });
    const commitsAfterMemory = commits.length;
    expect(commits.slice(commitsAfterMount, commitsAfterMemory)).toHaveLength(1);

    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        createLeaderThreadTabsProjectionEnvelope({
          type: "synced_projection_update",
          key: "leader",
          revision: 3,
          value: completed,
        }),
      );
    });
    const commitsAfterCompleted = commits.length;
    expect(commits.slice(commitsAfterMemory, commitsAfterCompleted)).toHaveLength(1);

    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        createLeaderThreadTabsProjectionEnvelope({
          type: "synced_projection_update",
          key: "leader",
          revision: 4,
          value: createLeaderThreadTabsProjectionValue({ ...completed }),
        }),
      );
    });

    expect(commitsAfterMount).toBeGreaterThan(0);
    expect(commits.slice(commitsAfterCompleted)).toEqual([]);
    expect(screen.getByTestId("thread-tab")).toHaveAttribute("data-thread-key", "q-1");
    expect(screen.getByTestId("thread-tab")).toHaveAttribute("data-closable", "true");
  });

  it("measures zero additional WorkBoardBar commits across repeated equal projection updates", () => {
    installLeaderProjection(createLeaderThreadTabsProjectionValue());
    const commitPhases: Parameters<ProfilerOnRenderCallback>[1][] = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase) => {
      commitPhases.push(phase);
    };
    render(
      <Profiler id="workboard" onRender={onRender}>
        <WorkBoardBar sessionId="leader" />
      </Profiler>,
    );
    const committedBeforeNoOps = commitPhases.length;

    act(() => {
      for (const revision of [2, 3, 4, 5]) {
        useStore.getState().applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({
            type: "synced_projection_update",
            key: "leader",
            revision,
            value: createLeaderThreadTabsProjectionValue(),
          }),
        );
      }
    });

    expect(committedBeforeNoOps).toBeGreaterThan(0);
    expect(commitPhases.slice(committedBeforeNoOps)).toEqual([]);
  });

  it("shows projected current status only in its owning feed and hides it from All Threads", () => {
    const mainStatus = {
      kind: "ready" as const,
      label: "Thread Ready" as const,
      threadKey: "main",
      summary: "main result ready",
      messageId: "a-main-ready",
      timestamp: 3,
      updatedAt: 3,
    };
    installLeaderProjection(createLeaderThreadTabsProjectionValue({ threadStatuses: { main: mainStatus } }));
    useStore.getState().setMessages("leader", [
      { id: "u-main", role: "user", content: "finish the main task", timestamp: 1 },
      {
        id: "a-main-ready",
        role: "assistant",
        content: "The main task is complete.",
        timestamp: 3,
        metadata: { threadStatusMarkers: [mainStatus] },
      },
    ]);

    const main = render(<MessageFeed sessionId="leader" threadKey="main" />);
    expect(screen.getByLabelText("Thread Ready for Main: main result ready")).toBeTruthy();
    main.unmount();

    render(<MessageFeed sessionId="leader" threadKey="all" />);
    expect(screen.queryByLabelText("Thread Ready for Main: main result ready")).toBeNull();
    expect(screen.queryByTestId("turn-thread-status-footer")).toBeNull();
  });

  it("uses projected Ready status for collapse policy and honors an explicit status clear", () => {
    const readyStatus = {
      kind: "ready" as const,
      label: "Thread Ready" as const,
      threadKey: "q-2",
      questId: "q-2",
      summary: "complete",
      messageId: "a-ready",
      timestamp: 3,
      updatedAt: 3,
    };
    const value = createLeaderThreadTabsProjectionValue({ threadStatuses: { "q-2": readyStatus } });
    installLeaderProjection(value);
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "finish q-2", timestamp: 1 },
      {
        id: "a-ready",
        role: "assistant",
        content: "q-2 is complete",
        timestamp: 3,
        metadata: {
          threadRefs: [{ threadKey: "q-2", questId: "q-2", source: "explicit" }],
          threadStatusMarkers: [readyStatus],
        },
      },
    ];
    const turns = buildFeedModel(messages, true).turns;
    const { result } = renderHook(() =>
      useCollapsePolicy({ autoCollapseReadyThreadKey: "q-2", sessionId: "leader", turns }),
    );
    expect(result.current.turnStates).toEqual([
      expect.objectContaining({ turnId: "u1", defaultExpanded: false, isActivityExpanded: false }),
    ]);

    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        createLeaderThreadTabsProjectionEnvelope({
          type: "synced_projection_update",
          key: "leader",
          revision: 2,
          value: createLeaderThreadTabsProjectionValue({ threadStatuses: {} }),
        }),
      );
    });
    expect(result.current.turnStates).toEqual([
      expect.objectContaining({ turnId: "u1", defaultExpanded: true, isActivityExpanded: true }),
    ]);
  });
});
