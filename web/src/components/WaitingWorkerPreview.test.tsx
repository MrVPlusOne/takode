// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../../shared/leader-thread-tabs-projection.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { BoardRowSessionStatus } from "../types.js";
import { createLeaderThreadTabsProjectionValue } from "../test-fixtures/leader-thread-tabs-projection.js";
import type { BoardRowData } from "./BoardTable.js";
import { resolveWaitingWorkerTarget } from "./WaitingWorkerPreview.js";
import { TurnThreadStatusFooter } from "./MessageFeedThreadStatus.js";
import { useMessageFeedStatusLayout } from "./use-message-feed-status-layout.js";

const getSessionActivityPreview = vi.fn();
const navigateToSession = vi.fn();
const navigateToSessionMessage = vi.fn();

vi.mock("../api.js", () => ({
  api: { getSessionActivityPreview: (...args: unknown[]) => getSessionActivityPreview(...args) },
}));
vi.mock("../utils/routing.js", () => ({
  navigateToSession: (...args: unknown[]) => navigateToSession(...args),
  navigateToSessionMessage: (...args: unknown[]) => navigateToSessionMessage(...args),
}));

/** Mirrors MessageFeed: the feed's status layout resolves the target, the status footer renders it. */
function FeedFooterHost({ threadKey = "q-42" }: { threadKey?: string }) {
  const { visibleThreadStatuses, workerPreviewTarget } = useMessageFeedStatusLayout(LEADER, threadKey);
  if (visibleThreadStatuses.length === 0 && !workerPreviewTarget) return null;
  return (
    <TurnThreadStatusFooter
      statuses={visibleThreadStatuses}
      workerPreviewTarget={workerPreviewTarget}
      currentThreadKey={threadKey}
    />
  );
}

const LEADER = "leader-1";
const WORKER = "worker-7";
const HELPER = "helper-9";
const PHASE_STARTED_AT = Date.parse("2026-10-05T10:00:00Z");

function waiting(threadKey = "q-42"): LeaderThreadStatus {
  return {
    kind: "waiting",
    label: "Thread Waiting",
    threadKey,
    questId: threadKey,
    summary: "worker implementing",
    messageId: "status-1",
    timestamp: 1,
    updatedAt: 1,
  };
}

function boardRow(overrides: Partial<BoardRowData> = {}): BoardRowData {
  return {
    questId: "q-42",
    title: "Live worker preview",
    worker: WORKER,
    workerNum: 7,
    status: "WORK",
    journey: {
      phaseIds: ["work", "memory"],
      mode: "active",
      activePhaseIndex: 0,
      currentPhaseId: "work",
      phaseTimings: { "0": { startedAt: PHASE_STARTED_AT } },
    },
    updatedAt: 1,
    ...overrides,
  };
}

function rowStatuses(
  status: "running" | "idle" | "archived" = "running",
  generationStartedAt?: number,
): Record<string, BoardRowSessionStatus> {
  return { "q-42": { worker: { sessionId: WORKER, sessionNum: 7, status, generationStartedAt } } };
}

function setLeaderState({
  statuses = { "q-42": waiting() },
  rows = [boardRow()],
  participants = rowStatuses(),
  leaderStatus = "idle",
}: {
  statuses?: Record<string, LeaderThreadStatus>;
  rows?: BoardRowData[];
  participants?: Record<string, BoardRowSessionStatus>;
  leaderStatus?: "idle" | "running";
} = {}) {
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, LEADER);
  act(() => {
    useStore.setState({
      syncedProjectionValues: new Map([[entryId, createLeaderThreadTabsProjectionValue({ threadStatuses: statuses })]]),
      syncedProjectionKeys: new Set([entryId]),
      sessionBoards: new Map([[LEADER, rows]]),
      sessionBoardRowStatuses: new Map([[LEADER, participants]]),
      sessionStatus: new Map([[LEADER, leaderStatus]]),
    });
  });
}

const PREVIEW = {
  lines: [
    { historyIndex: 10, kind: "message", text: "Checking the composer layout.", timestamp: PHASE_STARTED_AT + 1_000 },
    { historyIndex: 11, kind: "tool", toolName: "Read", text: "ChatView.tsx", timestamp: PHASE_STARTED_AT + 2_000 },
    {
      historyIndex: 12,
      kind: "tool",
      toolName: "Bash",
      text: "Run focused tests",
      timestamp: PHASE_STARTED_AT + 3_000,
    },
  ],
  lastActivityAt: PHASE_STARTED_AT + 3_000,
};

beforeEach(() => {
  localStorage.clear();
  getSessionActivityPreview.mockReset().mockResolvedValue(PREVIEW);
  navigateToSession.mockReset();
  navigateToSessionMessage.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveWaitingWorkerTarget", () => {
  const base = {
    threadKey: "q-42",
    statuses: [waiting()],
    boardRows: [boardRow()],
    rowStatuses: rowStatuses(),
  };

  it("shows for a waiting quest thread with an assigned worker", () => {
    expect(resolveWaitingWorkerTarget(base)).toEqual({
      questId: "q-42",
      sessions: [{ sessionId: WORKER, sessionNum: 7, status: "running", turnStartedAt: null, helper: false }],
      ownerWaits: [],
    });
  });

  it("adds the helpers the row waits on and names the owner's waits", () => {
    // A quest's owner can wait idle while a herded helper runs a step it cannot (`--wait-for #N`).
    const rows = [boardRow({ waitFor: ["#9", "q-5", "free-worker", "#7"], waitForInput: ["n-3"] })];
    const participants: Record<string, BoardRowSessionStatus> = {
      "q-42": {
        worker: { sessionId: WORKER, sessionNum: 7, status: "idle" },
        helpers: [{ sessionId: HELPER, sessionNum: 9, status: "running", generationStartedAt: 50 }],
      },
    };
    expect(resolveWaitingWorkerTarget({ ...base, boardRows: rows, rowStatuses: participants })).toEqual({
      questId: "q-42",
      sessions: [
        { sessionId: WORKER, sessionNum: 7, status: "idle", turnStartedAt: null, helper: false },
        { sessionId: HELPER, sessionNum: 9, status: "running", turnStartedAt: 50, helper: true },
      ],
      // The owner's own number and the queue-only free-worker token are not waits.
      ownerWaits: ["your answer", "#9", "q-5"],
    });
    // A queued row's wait-for list is about starting the quest, not about a working owner.
    const checkpoint = resolveWaitingWorkerTarget({
      ...base,
      boardRows: [boardRow({ status: "USER_CHECKPOINTING", waitForInput: ["n-3"] })],
    });
    expect(checkpoint?.ownerWaits).toEqual(["your answer"]);
  });

  it("carries the server turn start only while the worker is running", () => {
    // The turn timer reads the board participant's server-set generation start, so it
    // is the same on every device and survives reloads.
    const started = { ...base, rowStatuses: rowStatuses("running", PHASE_STARTED_AT) };
    expect(resolveWaitingWorkerTarget(started)?.sessions[0]?.turnStartedAt).toBe(PHASE_STARTED_AT);
    const idle = resolveWaitingWorkerTarget({ ...base, rowStatuses: rowStatuses("idle", PHASE_STARTED_AT) });
    expect(idle?.sessions[0]?.turnStartedAt).toBeNull();
  });

  it("shows while the quest is in an active phase, with or without a leader status in the tab", () => {
    // A side quest's updates go to the tab its request came from, so its own tab often has no
    // status at all; the preview follows the board row instead of the leader's markers.
    for (const status of ["WORKING", "USER_CHECKPOINTING", "MEMORY", "PLANNING", "IMPLEMENTING"]) {
      expect(resolveWaitingWorkerTarget({ ...base, statuses: [], boardRows: [boardRow({ status })] })).not.toBeNull();
    }
  });

  it("hides before the worker starts and after it hands the quest to the landing queue", () => {
    // The assigned worker may be busy with another quest then, so its activity would mislead.
    for (const status of ["PROPOSED", "QUEUED", "LANDING"]) {
      expect(resolveWaitingWorkerTarget({ ...base, boardRows: [boardRow({ status })] })).toBeNull();
    }
  });

  it("hides for a Ready posted in this tab during the current phase, not for an older one", () => {
    const ready = (updatedAt: number): LeaderThreadStatus => ({
      ...waiting(),
      kind: "ready",
      label: "Thread Ready",
      updatedAt,
    });
    expect(resolveWaitingWorkerTarget({ ...base, statuses: [ready(PHASE_STARTED_AT + 1)] })).toBeNull();
    // A Ready from before the row entered its current phase (a reopened quest, or Memory after
    // an accepted Work result) no longer describes what the worker is doing.
    expect(resolveWaitingWorkerTarget({ ...base, statuses: [ready(PHASE_STARTED_AT - 1)] })).not.toBeNull();
  });

  it("hides for Main, completed or removed rows, unassigned or archived workers", () => {
    expect(resolveWaitingWorkerTarget({ ...base, threadKey: "main" })).toBeNull();
    expect(resolveWaitingWorkerTarget({ ...base, boardRows: [boardRow({ completedAt: 5 })] })).toBeNull();
    expect(resolveWaitingWorkerTarget({ ...base, boardRows: [] })).toBeNull();
    expect(
      resolveWaitingWorkerTarget({ ...base, boardRows: [boardRow({ worker: undefined })], rowStatuses: {} }),
    ).toBeNull();
    expect(resolveWaitingWorkerTarget({ ...base, rowStatuses: rowStatuses("archived") })).toBeNull();
  });
});

describe("WaitingWorkerPreview", () => {
  it("renders the latest worker lines and opens the worker session or a specific line", async () => {
    setLeaderState();
    render(<FeedFooterHost />);

    // The lines list renders "No activity yet" until the fetched preview arrives, so wait for the
    // fetched text itself; finding the list alone raced the fetch on loaded CI runners.
    await screen.findByText("Checking the composer layout.");
    const lines = screen.getByTestId("waiting-worker-preview-lines");
    expect(lines).toHaveTextContent("Checking the composer layout.");
    expect(lines).toHaveTextContent("Run focused tests");
    // A working worker is shown by its pulsing dot alone, without a "working" pill.
    expect(screen.getByTestId("waiting-worker-preview-dot")).toHaveAccessibleName("working");
    expect(screen.queryByTestId("waiting-worker-preview-status")).not.toBeInTheDocument();
    // The preview never shows a second "Purring..." activity label.
    expect(screen.queryByText(/Purring/)).not.toBeInTheDocument();
    expect(getSessionActivityPreview).toHaveBeenCalledWith(WORKER);

    fireEvent.click(screen.getByText("ChatView.tsx"));
    expect(navigateToSessionMessage).toHaveBeenCalledWith(WORKER, 11);
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(navigateToSession).toHaveBeenCalledWith(WORKER);
  });

  // The title bar stays short: the quest header above already names the worker's
  // machine and current phase, so the preview repeats neither.
  it("leaves the worker's machine and phase to the quest header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ hosts: [{ id: "h1", name: "devbox", online: true }] }))),
    );
    try {
      setLeaderState();
      act(() => {
        useStore.setState({
          sdkSessions: [{ sessionId: WORKER, hostId: "h1", state: "running", cwd: "/srv", createdAt: 0 }] as never,
        });
      });
      render(<FeedFooterHost />);
      const preview = await screen.findByTestId("waiting-worker-preview");
      await screen.findByText("Run focused tests");
      expect(preview).not.toHaveTextContent("devbox");
      expect(preview).not.toHaveTextContent("Work");
    } finally {
      vi.unstubAllGlobals();
      act(() => useStore.setState({ sdkSessions: [] }));
    }
  });

  it("keys the card's left edge to the worker status so it stands apart from activity groups", async () => {
    // A working worker gets a green edge and tint; an idle one a neutral edge.
    setLeaderState();
    const { unmount } = render(<FeedFooterHost />);
    const working = await screen.findByTestId("waiting-worker-preview");
    expect(working.className).toContain("border-l-cc-success/70");
    unmount();

    setLeaderState({ participants: rowStatuses("idle") });
    render(<FeedFooterHost />);
    const idle = await screen.findByTestId("waiting-worker-preview");
    expect(idle.className).toContain("border-l-cc-muted/50");
    expect(idle.className).not.toContain("border-l-cc-success");
  });

  it("ticks the working worker's current turn time next to its number", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(PHASE_STARTED_AT + 12 * 60_000 + 5_000);
    setLeaderState({ participants: rowStatuses("running", PHASE_STARTED_AT) });
    render(<FeedFooterHost />);

    const timer = screen.getByTestId("waiting-worker-preview-turn-time");
    expect(timer).toHaveTextContent("· 12m 5s");
    // Live: the timer advances every second without a server update.
    act(() => vi.advanceTimersByTime(1_000));
    expect(timer).toHaveTextContent("· 12m 6s");

    // Once the worker stops, the timer gives way to the idle pill.
    setLeaderState({ participants: rowStatuses("idle") });
    expect(screen.queryByTestId("waiting-worker-preview-turn-time")).not.toBeInTheDocument();
    expect(screen.getByTestId("waiting-worker-preview-status")).toHaveTextContent("idle");
  });

  it("shows idle time since the last activity while the thread still waits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PREVIEW.lastActivityAt + 3 * 60_000);
    setLeaderState({ participants: rowStatuses("idle") });
    render(<FeedFooterHost />);

    await waitFor(() =>
      expect(screen.getByTestId("waiting-worker-preview-status")).toHaveTextContent("idle · last activity 3m ago"),
    );
  });

  it("renders in the feed's status footer below the Waiting chip, and only in quest threads", async () => {
    // The preview is part of the chat feed: it sits inside the thread status footer, under
    // the Waiting chip, so it scrolls with the conversation instead of being pinned.
    setLeaderState();
    render(<FeedFooterHost />);
    const footer = screen.getByTestId("turn-thread-status-footer");
    const chip = screen.getByLabelText(/Thread Waiting for thread:q-42/);
    const preview = screen.getByTestId("waiting-worker-preview");
    expect(footer).toContainElement(preview);
    expect(chip.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByText("Run focused tests");

    // Main never hosts a worker preview, even with a Waiting status.
    setLeaderState({ statuses: { main: { ...waiting("main"), questId: undefined } } });
    const { container } = render(<FeedFooterHost threadKey="main" />);
    expect(container.querySelector('[data-testid="waiting-worker-preview"]')).toBeNull();
  });

  it("does not flash while the leader clears and re-writes the Waiting marker", () => {
    setLeaderState();
    render(<FeedFooterHost />);
    const panel = screen.getByTestId("waiting-worker-preview");

    // Leader activity in the thread clears the status; the quest is still in Work.
    setLeaderState({ statuses: {}, leaderStatus: "running" });
    setLeaderState({ statuses: {}, leaderStatus: "idle" });
    setLeaderState();
    // Same DOM node: the panel never unmounted.
    expect(screen.getByTestId("waiting-worker-preview")).toBe(panel);
  });

  it("shows in a tab with no status at all, and goes on Ready or when the row leaves Work", () => {
    // A side quest's tab: no leader status there, but its worker is on it.
    setLeaderState({ statuses: {} });
    render(<FeedFooterHost />);
    expect(screen.getByTestId("waiting-worker-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-status-summary")).not.toBeInTheDocument();

    setLeaderState({ statuses: {}, rows: [boardRow({ status: "LANDING" })] });
    expect(screen.queryByTestId("waiting-worker-preview")).not.toBeInTheDocument();
    setLeaderState({ statuses: {}, rows: [boardRow({ status: "MEMORY" })] });
    expect(screen.getByTestId("waiting-worker-preview")).toBeInTheDocument();
    const ready = {
      ...waiting(),
      kind: "ready" as const,
      label: "Thread Ready" as const,
      updatedAt: PHASE_STARTED_AT + 1,
    };
    setLeaderState({ statuses: { "q-42": ready } });
    expect(screen.queryByTestId("waiting-worker-preview")).not.toBeInTheDocument();
  });

  it("names what an idle owner waits for instead of a bare idle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PREVIEW.lastActivityAt + 3 * 60_000);
    setLeaderState({ rows: [boardRow({ waitFor: ["q-5"] })], participants: rowStatuses("idle") });
    act(() => {
      useStore.setState({
        sdkSessions: [
          {
            sessionId: WORKER,
            state: "connected",
            cwd: "/srv",
            createdAt: 0,
            pendingTimerCount: 1,
            waits: [{ kind: "job", description: "Run the full gate", startedAt: 1 }],
          },
        ] as never,
      });
    });
    try {
      render(<FeedFooterHost />);
      await waitFor(() =>
        expect(screen.getByTestId("waiting-worker-preview-status")).toHaveTextContent(
          'waiting for q-5; background job "Run the full gate"; a timer · last activity 3m ago',
        ),
      );
    } finally {
      act(() => useStore.setState({ sdkSessions: [] }));
    }
  });

  it("shows helpers as tabs and follows whichever session started working last", async () => {
    // Several sessions share one card (no stacked previews): the helper that is working is
    // shown, a tapped tab stays, and the preview moves on when the working session changes.
    const helperPreview = { ...PREVIEW, lines: [{ ...PREVIEW.lines[0], text: "Pasting into Slack." }] };
    getSessionActivityPreview.mockImplementation(async (id: string) => (id === HELPER ? helperPreview : PREVIEW));
    const participants = (
      owner: "idle" | "running",
      helper: "idle" | "running",
    ): Record<string, BoardRowSessionStatus> => ({
      "q-42": {
        worker: {
          sessionId: WORKER,
          sessionNum: 7,
          status: owner,
          generationStartedAt: owner === "running" ? 20 : undefined,
        },
        helpers: [
          {
            sessionId: HELPER,
            sessionNum: 9,
            status: helper,
            generationStartedAt: helper === "running" ? 10 : undefined,
          },
        ],
      },
    });
    setLeaderState({ rows: [boardRow({ waitFor: ["#9"] })], participants: participants("idle", "running") });
    render(<FeedFooterHost />);

    const tabs = screen.getAllByTestId("waiting-worker-preview-tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["#7", "#9"]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    await screen.findByText("Pasting into Slack.");
    expect(screen.getByTestId("waiting-worker-preview-turn-time")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(navigateToSession).toHaveBeenCalledWith(HELPER);

    // The owner's tab says what it waits for.
    fireEvent.click(tabs[0]!);
    await screen.findByText("Checking the composer layout.");
    expect(screen.getByTestId("waiting-worker-preview-status")).toHaveTextContent("waiting for #9");

    // The helper's turn ends and a new one starts: the preview moves back to the helper by itself.
    const helperRow = [boardRow({ waitFor: ["#9"] })];
    setLeaderState({ rows: helperRow, participants: participants("idle", "idle") });
    expect(screen.getAllByTestId("waiting-worker-preview-tab")[0]).toHaveAttribute("aria-selected", "true");
    setLeaderState({ rows: helperRow, participants: participants("idle", "running") });
    expect(screen.getAllByTestId("waiting-worker-preview-tab")[1]).toHaveAttribute("aria-selected", "true");
    // And to the owner once it starts working after the helper did.
    setLeaderState({ rows: helperRow, participants: participants("running", "running") });
    expect(screen.getAllByTestId("waiting-worker-preview-tab")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("polls only while the worker is generating", async () => {
    vi.useFakeTimers();
    setLeaderState({ participants: rowStatuses("idle") });
    render(<FeedFooterHost />);
    expect(getSessionActivityPreview).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(getSessionActivityPreview).toHaveBeenCalledTimes(1);

    // Becoming active refetches immediately and then keeps the slice live.
    setLeaderState({ participants: rowStatuses("running") });
    expect(getSessionActivityPreview).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(getSessionActivityPreview).toHaveBeenCalledTimes(3);
  });
});
