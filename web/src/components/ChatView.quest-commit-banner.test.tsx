// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardParticipantStatus, BrowserIncomingMessage } from "../types.js";
import { useStore } from "../store.js";

const mockSetActiveTab = vi.fn();

vi.mock("./QuestInlineLink.js", () => ({
  QuestInlineLink: ({ questId, children }: { questId: string; children?: ReactNode }) => (
    <a href={"#quest-" + questId}>{children ?? questId}</a>
  ),
}));

vi.mock("./SessionInlineLink.js", () => ({
  SessionInlineLink: ({
    sessionNum,
    ariaLabel,
    dataTestId,
    title,
    children,
  }: {
    sessionNum?: number;
    ariaLabel?: string;
    dataTestId?: string;
    title?: string;
    children?: ReactNode;
  }) => (
    <a href={"#session-" + sessionNum} aria-label={ariaLabel} data-testid={dataTestId} title={title}>
      {children}
    </a>
  ),
}));

vi.mock("./session-participant-status.js", () => ({
  useParticipantSessionStatusDotProps: () => ({ status: "idle" }),
}));

vi.mock("./QuestJourneyTimeline.js", () => ({
  isCompletedJourneyPresentationStatus: (status?: string | null) => status === "done" || status === "DONE",
  QuestJourneyPreviewCard: () => <div data-testid="quest-journey-preview-card" />,
  QuestJourneyTimeline: () => <span data-testid="quest-journey-compact-summary">implement</span>,
}));

import { QuestThreadBanner, type QuestThreadBannerRow } from "./ChatView.js";

const LEADER_ID = "leader-968";
const QUEST_ID = "q-968";
const BOARD_ROW = {
  questId: QUEST_ID,
  title: "Thread navigation rework",
  worker: "worker-968",
  workerNum: 1321,
  status: "IMPLEMENTING",
  createdAt: 1,
  updatedAt: 2,
};

type BoardUpdatedMessage = Extract<BrowserIncomingMessage, { type: "board_updated" }>;

function boardUpdatedMessage(reviewer: BoardParticipantStatus | null): BoardUpdatedMessage {
  return {
    type: "board_updated",
    board: [BOARD_ROW],
    completedBoard: [],
    rowSessionStatuses: {
      [QUEST_ID]: {
        worker: { sessionId: "worker-968", sessionNum: 1321, name: "Clear Mesa", status: "running" },
        reviewer,
      },
    },
  };
}

function applyBoardUpdated(message: BoardUpdatedMessage) {
  const store = useStore.getState();
  store.setSessionBoard(LEADER_ID, message.board);
  store.setSessionCompletedBoard(LEADER_ID, message.completedBoard);
  store.setSessionBoardRowStatuses(LEADER_ID, message.rowSessionStatuses ?? {});
}

function StoreQuestThreadBanner({ commitShas = ["abc1234", "def5678"] }: { commitShas?: string[] }) {
  const boardRow = useStore((state) => state.sessionBoards.get(LEADER_ID)?.[0]);
  const rowStatus = useStore((state) => state.sessionBoardRowStatuses.get(LEADER_ID)?.[QUEST_ID]);
  if (!boardRow) return null;
  const row: QuestThreadBannerRow = {
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    title: boardRow.title ?? QUEST_ID,
    boardStatus: boardRow.status,
    commitShas,
    section: "active",
    boardRow,
    rowStatus,
  };
  return <QuestThreadBanner row={row} threadKey={QUEST_ID} />;
}

describe("QuestThreadBanner commit affordance", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().setSdkSessions([
      {
        sessionId: "worker-968",
        sessionNum: 1321,
        state: "running",
        cwd: "/worker",
        createdAt: 1,
        name: "Clear Mesa",
      },
      {
        sessionId: "reviewer-968",
        sessionNum: 1306,
        state: "connected",
        cwd: "/reviewer",
        createdAt: 2,
        name: "Reviewer Long Name",
      },
      {
        sessionId: "reviewer-969",
        sessionNum: 1307,
        state: "running",
        cwd: "/replacement-reviewer",
        createdAt: 3,
        name: "Replacement Reviewer",
      },
    ]);
    useStore.setState({ setActiveTab: mockSetActiveTab });
    mockSetActiveTab.mockClear();
  });

  // Apply successive board_updated-shaped payloads to the real store so the
  // banner proves subscription updates, rather than prop-only rerenders.
  it("applies producer-shaped add, replacement, and removal projections without losing worker or commit state", () => {
    applyBoardUpdated(boardUpdatedMessage(null));
    render(<StoreQuestThreadBanner />);

    const banner = screen.getByTestId("quest-thread-banner");
    const workerChip = within(banner).getByLabelText("Worker #1321 Clear Mesa");
    expect(workerChip).toHaveAttribute("href", "#session-1321");
    expect(within(workerChip).getByText("Worker")).toHaveClass("max-[319px]:hidden");
    expect(within(workerChip).getByTestId("session-role-icon-worker")).toBeInTheDocument();
    expect(within(banner).queryByLabelText(/^Reviewer #/)).not.toBeInTheDocument();
    expect(within(banner).getByTestId("quest-thread-commit-button")).toHaveTextContent("2 commits");

    act(() => {
      applyBoardUpdated(
        boardUpdatedMessage({
          sessionId: "reviewer-968",
          sessionNum: 1306,
          name: "Reviewer Long Name",
          status: "idle",
        }),
      );
    });
    const addedReviewer = within(banner).getByLabelText("Reviewer #1306 Reviewer Long Name");
    expect(addedReviewer).toHaveAttribute("href", "#session-1306");
    expect(addedReviewer).toHaveAttribute("title", "Open reviewer session #1306 Reviewer Long Name");

    act(() => {
      applyBoardUpdated(
        boardUpdatedMessage({
          sessionId: "reviewer-969",
          sessionNum: 1307,
          name: "Replacement Reviewer",
          status: "running",
        }),
      );
    });
    expect(within(banner).queryByLabelText("Reviewer #1306 Reviewer Long Name")).not.toBeInTheDocument();
    expect(within(banner).getByLabelText("Reviewer #1307 Replacement Reviewer")).toHaveAttribute(
      "href",
      "#session-1307",
    );

    act(() => applyBoardUpdated(boardUpdatedMessage(null)));
    expect(within(banner).queryByLabelText(/^Reviewer #/)).not.toBeInTheDocument();
    expect(within(banner).getByLabelText("Worker #1321 Clear Mesa")).toHaveAttribute("href", "#session-1321");
    expect(within(banner).getByTestId("quest-thread-commit-button")).toHaveTextContent("2 commits");
    expect(banner).not.toHaveTextContent("Clear Mesa");
    expect(banner).not.toHaveTextContent("Replacement Reviewer");
  });

  it("shows a code-commit count chip that opens the Diff tab", () => {
    applyBoardUpdated(
      boardUpdatedMessage({
        sessionId: "reviewer-968",
        sessionNum: 1306,
        name: "Reviewer Long Name",
        status: "idle",
      }),
    );
    render(<StoreQuestThreadBanner />);

    const commitButton = screen.getByTestId("quest-thread-commit-button");
    expect(commitButton).toHaveTextContent("2 commits");
    expect(commitButton).toHaveAccessibleName("Open q-968 recorded commit diffs, 2 commits");

    fireEvent.click(commitButton);
    expect(mockSetActiveTab).toHaveBeenCalledWith("diff");
  });

  it("preserves the zero-commit affordance when no reviewer is assigned", () => {
    applyBoardUpdated(boardUpdatedMessage(null));
    render(<StoreQuestThreadBanner commitShas={[]} />);

    expect(screen.queryByLabelText(/^Reviewer #/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Worker #1321 Clear Mesa")).toBeInTheDocument();
    expect(screen.getByTestId("quest-thread-commit-button")).toHaveAccessibleName(
      "Open q-968 recorded commit diffs, 0 commits",
    );
  });

  it("suppresses stale queued wait metadata when the quest row is already done", () => {
    const row: QuestThreadBannerRow = {
      threadKey: "q-1812",
      questId: "q-1812",
      title: "Summarize Parsewave VaultScan Example",
      status: "done",
      boardStatus: "QUEUED",
      section: "done",
      journey: { mode: "active", phaseIds: ["alignment", "work", "memory"], currentPhaseId: "work" },
      boardRow: {
        questId: "q-1812",
        title: "Summarize Parsewave VaultScan Example",
        status: "QUEUED",
        waitFor: ["free-worker"],
        updatedAt: 1,
      },
    };

    render(<QuestThreadBanner row={row} threadKey="q-1812" />);

    const banner = screen.getByTestId("quest-thread-banner");
    expect(banner).toHaveTextContent("q-1812");
    expect(banner).toHaveTextContent("Summarize Parsewave VaultScan Example");
    expect(within(banner).queryByTestId("quest-thread-queued-status-chip")).not.toBeInTheDocument();
    expect(banner).not.toHaveTextContent("Queued, waiting for free worker");
  });
});
