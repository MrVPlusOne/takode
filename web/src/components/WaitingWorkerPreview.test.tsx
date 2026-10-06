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
import { WAITING_WORKER_PREVIEW_HOLD_MS, resolveWaitingWorkerGate } from "./WaitingWorkerPreview.js";
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

function rowStatuses(status: "running" | "idle" | "archived" = "running"): Record<string, BoardRowSessionStatus> {
  return { "q-42": { worker: { sessionId: WORKER, sessionNum: 7, status } } };
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

describe("resolveWaitingWorkerGate", () => {
  const base = {
    threadKey: "q-42",
    statuses: [waiting()],
    boardRows: [boardRow()],
    rowStatuses: rowStatuses(),
  };

  it("shows for a waiting quest thread with an assigned worker", () => {
    expect(resolveWaitingWorkerGate(base)).toEqual({
      kind: "show",
      target: {
        questId: "q-42",
        workerSessionId: WORKER,
        workerNum: 7,
        workerStatus: "running",
        phaseLabel: "Work",
        phaseStartedAt: PHASE_STARTED_AT,
      },
    });
  });

  it("treats a cleared status as soft so a re-written marker does not flash", () => {
    expect(resolveWaitingWorkerGate({ ...base, statuses: [] }).kind).toBe("soft");
  });

  it("hides immediately for Ready, Main, completed rows, unassigned or archived workers", () => {
    // Each case is a definitive change, not churn, so no hold applies.
    const ready = { ...waiting(), kind: "ready" as const, label: "Thread Ready" as const };
    expect(resolveWaitingWorkerGate({ ...base, statuses: [ready] }).kind).toBe("hide");
    expect(resolveWaitingWorkerGate({ ...base, threadKey: "main" }).kind).toBe("hide");
    expect(resolveWaitingWorkerGate({ ...base, boardRows: [boardRow({ completedAt: 5 })] }).kind).toBe("hide");
    expect(
      resolveWaitingWorkerGate({ ...base, boardRows: [boardRow({ worker: undefined })], rowStatuses: {} }).kind,
    ).toBe("hide");
    expect(resolveWaitingWorkerGate({ ...base, rowStatuses: rowStatuses("archived") }).kind).toBe("hide");
  });
});

describe("WaitingWorkerPreview", () => {
  it("renders the latest worker lines and opens the worker session or a specific line", async () => {
    setLeaderState();
    render(<FeedFooterHost />);

    const lines = await screen.findByTestId("waiting-worker-preview-lines");
    expect(lines).toHaveTextContent("Checking the composer layout.");
    expect(lines).toHaveTextContent("Run focused tests");
    expect(screen.getByTestId("waiting-worker-preview-status")).toHaveTextContent("working");
    // The preview never shows a second "Purring..." activity label.
    expect(screen.queryByText(/Purring/)).not.toBeInTheDocument();
    expect(getSessionActivityPreview).toHaveBeenCalledWith(WORKER);

    fireEvent.click(screen.getByText("ChatView.tsx"));
    expect(navigateToSessionMessage).toHaveBeenCalledWith(WORKER, 11);
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(navigateToSession).toHaveBeenCalledWith(WORKER);
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
    vi.useFakeTimers();
    setLeaderState();
    render(<FeedFooterHost />);
    const panel = screen.getByTestId("waiting-worker-preview");

    // Leader activity in the thread clears the status for the whole leader turn.
    setLeaderState({ statuses: {}, leaderStatus: "running" });
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId("waiting-worker-preview")).toBe(panel);

    // The turn ends; a slightly late Waiting marker still lands inside the grace period.
    setLeaderState({ statuses: {}, leaderStatus: "idle" });
    act(() => vi.advanceTimersByTime(WAITING_WORKER_PREVIEW_HOLD_MS - 1_000));
    setLeaderState();
    act(() => vi.advanceTimersByTime(WAITING_WORKER_PREVIEW_HOLD_MS * 2));
    // Same DOM node: the panel never unmounted.
    expect(screen.getByTestId("waiting-worker-preview")).toBe(panel);
  });

  it("removes the panel after the grace period when no Waiting status returns, and immediately on Ready", () => {
    vi.useFakeTimers();
    setLeaderState();
    const { unmount } = render(<FeedFooterHost />);

    setLeaderState({ statuses: {} });
    act(() => vi.advanceTimersByTime(WAITING_WORKER_PREVIEW_HOLD_MS - 100));
    expect(screen.getByTestId("waiting-worker-preview")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("waiting-worker-preview")).not.toBeInTheDocument();

    // An expired hold does not come back just because the leader starts generating again.
    setLeaderState({ statuses: {}, leaderStatus: "running" });
    expect(screen.queryByTestId("waiting-worker-preview")).not.toBeInTheDocument();
    unmount();

    setLeaderState();
    render(<FeedFooterHost />);
    expect(screen.getByTestId("waiting-worker-preview")).toBeInTheDocument();
    setLeaderState({ statuses: { "q-42": { ...waiting(), kind: "ready", label: "Thread Ready" } } });
    expect(screen.queryByTestId("waiting-worker-preview")).not.toBeInTheDocument();
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
