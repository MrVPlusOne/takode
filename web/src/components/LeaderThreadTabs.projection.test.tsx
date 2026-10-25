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
import type { BoardRowData } from "./BoardTable.js";
import { WorkBoardBar } from "./WorkBoardBar.js";
import { groupThreadTabKeys, listedThreadTab, listedThreadTabs } from "../test-fixtures/thread-tab-rows.js";

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
    ownership: "own",
    active: false,
    queued: false,
    proposed: false,
    neverStartedScheduled: false,
    completed: false,
    canClose: true,
    updatedAt: 10,
    groupChangedAt: 10,
    ...rest,
    attention: {
      needsInput: false,
      mutedNeedsInput: false,
      reviewUnread: false,
      updatedAt: 0,
      changedAt: 0,
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
      attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
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

    const tabs = listedThreadTabs();
    expect(tabs.map((tab) => tab.getAttribute("data-thread-key")).sort()).toEqual(["q-1", "q-2"]);
    const q1 = listedThreadTab("q-1")!;
    expect(q1).toHaveAttribute("data-needs-input", "true");
    expect(within(q1).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");
    expect(listedThreadTab("q-2")).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    // The stale local tab is not open: it is no group's member.
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

    await waitFor(() => expect(listedThreadTab("q-2")).toHaveAttribute("data-title-color", "var(--color-cc-muted)"));
  });

  it("keeps active Work color and the completed Waiting foreground on listed tabs", () => {
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
          durationSummary: null,
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
          durationSummary: null,
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
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
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

    // No prompt or unread result: neither attention group appears.
    const groups = screen.getAllByTestId("thread-tab-group-chip").map((chip) => chip.dataset.group);
    expect(groups).not.toContain("needs-input");
    expect(groups).not.toContain("new-results");
    const completedRow = listedThreadTab("q-3")!;
    const activeWorkRow = listedThreadTab("q-4")!;

    // A finished quest with Thread Waiting reads in the normal foreground; the active Work
    // quest keeps its phase color although a stale hydrated record says it is done.
    expect(completedRow).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(within(completedRow).getByRole("button", { name: "Close q-3" })).toBeTruthy();
    expect(activeWorkRow).toHaveAttribute("data-title-color", "var(--color-cc-phase-thread-tab-title-work, #166534)");
    expect(within(activeWorkRow).queryByRole("button", { name: "Close q-4" })).toBeNull();
  });

  it("keeps projected order inside a group while exposing scheduled close controls", () => {
    // The server-authored projection owns ordering and closeability. Groups file tabs by
    // status, but inside a group (equal change times here) the projected order holds, and
    // in-motion tabs never become dismissible.
    const tabs = [
      projectedTab("q-101", {
        title: "Alignment work",
        boardStatus: "PLANNING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "alignment",
          activePhaseIndex: 0,
          phaseCount: 3,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
      projectedTab("q-102", {
        title: "Implementation work",
        boardStatus: "WORKING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
          phaseCount: 3,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
      projectedTab("q-103", {
        title: "Checkpoint work",
        boardStatus: "USER_CHECKPOINTING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
          currentPhaseId: "user-checkpoint",
          activePhaseIndex: 2,
          phaseCount: 5,
          durationSummary: null,
        },
        active: true,
        canClose: false,
        attention: { needsInput: true, mutedNeedsInput: false, reviewUnread: false, updatedAt: 30, changedAt: 30 },
      }),
      projectedTab("q-104", {
        title: "Memory work",
        boardStatus: "MEMORY",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "memory",
          activePhaseIndex: 2,
          phaseCount: 3,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
      projectedTab("q-105", {
        title: "Queued follow-up",
        boardStatus: "QUEUED",
        active: false,
        queued: true,
        canClose: true,
      }),
      projectedTab("q-106", {
        title: "Proposed follow-up",
        boardStatus: "PROPOSED",
        active: false,
        proposed: true,
        canClose: true,
      }),
      projectedTab("q-107", {
        title: "Completed follow-up",
        boardStatus: "DONE",
        active: false,
        completed: true,
        canClose: true,
      }),
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
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
        threadStatuses: {},
        activePhaseSummary: [],
      }),
    );
    const onCloseThreadTab = vi.fn();

    render(<WorkBoardBar sessionId="leader" currentThreadKey="q-105" onCloseThreadTab={onCloseThreadTab} />);

    expect(groupThreadTabKeys("needs-input")).toEqual(["q-103"]);
    expect(groupThreadTabKeys("in-progress")).toEqual(["q-101", "q-102", "q-104", "q-105", "q-106"]);
    expect(groupThreadTabKeys("done")).toEqual(["q-107"]);

    for (const key of ["q-101", "q-102", "q-103", "q-104"]) {
      expect(listedThreadTab(key)).toHaveAttribute("data-closable", "false");
      expect(within(listedThreadTab(key)!).queryByTestId("thread-tab-list-row-close")).toBeNull();
    }
    fireEvent.click(within(listedThreadTab("q-105")!).getByRole("button", { name: "Close q-105" }));
    expect(onCloseThreadTab).toHaveBeenCalledWith("q-105", "q-106");
    // q-106 is last in In progress, so the tab above it in that group opens next, not q-107
    // from Done.
    fireEvent.click(within(listedThreadTab("q-106")!).getByRole("button", { name: "Close q-106" }));
    expect(onCloseThreadTab).toHaveBeenLastCalledWith("q-106", "q-105");
  });

  it("does not rebuild leader tabs from raw board rows when the current projection is unavailable", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", isOrchestrator: true } as never],
      sessionBoards: new Map([
        [
          "leader",
          [
            { questId: "q-201", status: "WORKING", title: "Current work", updatedAt: 30 },
            { questId: "q-202", status: "QUEUED", title: "Queued follow-up", updatedAt: 20 },
          ],
        ],
      ]),
    });

    render(<WorkBoardBar sessionId="leader" openThreadKeys={["q-202", "q-201"]} />);

    expect(screen.queryByTestId("thread-tab-group-chip")).toBeNull();
    expect(screen.getByTestId("thread-tab-group-main")).toBeTruthy();
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
        durationSummary: null,
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
          changedAt: 0,
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

    const tab = () => listedThreadTab("q-700")!;
    expect(tab()).toHaveAttribute("data-closable", "false");
    expect(tab()).toHaveAttribute("data-title-color", "var(--color-cc-phase-thread-tab-title-work, #166534)");
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
    expect(tab()).toHaveAttribute("data-title-color", "var(--color-cc-phase-thread-tab-title-work, #166534)");
    expect(within(tab()).queryByRole("button", { name: "Close q-700" })).toBeNull();

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
              changedAt: 0,
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
      expect(tab()).toHaveAttribute("data-closable", "true");
      expect(tab()).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
      expect(within(tab()).getByRole("button", { name: "Close q-700" })).toBeTruthy();
    });
  });

  it("does not revive local completion from a projection value without current-build authority", () => {
    const legacyTab = projectedTab("q-701", { active: true, canClose: false });
    const invalidProjection = createLeaderThreadTabsProjectionValue({
      tabState: {
        version: 1,
        orderedOpenThreadKeys: ["q-701"],
        closedThreadTombstones: [],
        updatedAt: 10,
      },
      tabs: [legacyTab],
      threadStatuses: {},
    }) as Partial<LeaderThreadTabsProjectionValue>;
    delete invalidProjection.currentQuestStateVersion;
    installLeaderProjection(invalidProjection as LeaderThreadTabsProjectionValue);

    render(<WorkBoardBar sessionId="leader" currentThreadKey="main" onCloseThreadTab={vi.fn()} />);

    expect(screen.queryByTestId("thread-tab-group-chip")).toBeNull();
  });

  it("combines restored local tabs with derived projection tabs while tab state is absent", () => {
    const shared = projectedTab("q-702", {
      attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: true, updatedAt: 30, changedAt: 30 },
    });
    const derived = projectedTab("q-703", {
      attention: { needsInput: false, mutedNeedsInput: true, reviewUnread: false, updatedAt: 20, changedAt: 20 },
    });
    installLeaderProjection(
      createLeaderThreadTabsProjectionValue({
        tabState: null,
        tabs: [shared, derived],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
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

    // q-702's unread result files it under New results, after the in-progress tabs. Among
    // those, the projected q-703 changed group more recently than the restored local q-701,
    // which has no server time yet.
    expect(groupThreadTabKeys("in-progress")).toEqual(["q-703", "q-701"]);
    expect(groupThreadTabKeys("new-results")).toEqual(["q-702"]);
    expect(listedThreadTab("q-702")).toHaveAttribute("data-blue-notification", "true");
    expect(listedThreadTab("q-703")).toHaveAttribute("data-muted-needs-input", "true");
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
            durationSummary: null,
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
    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1"]);
    expect(listedThreadTab("q-1")).toHaveAttribute("data-closable", "true");
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
