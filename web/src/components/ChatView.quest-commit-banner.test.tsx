// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRowSessionStatus } from "../types.js";

const mockSetActiveTab = vi.fn();

vi.mock("../store.js", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      quests: [],
      questDetails: new Map(),
      sdkSessions: [
        { sessionId: "worker-968", sessionNum: 1321, state: "running", name: "Clear Mesa" },
        { sessionId: "reviewer-968", sessionNum: 1306, state: "connected", name: "Reviewer Long Name" },
      ],
      setActiveTab: mockSetActiveTab,
    }),
}));

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

function participantRow(): QuestThreadBannerRow {
  return {
    threadKey: "q-968",
    questId: "q-968",
    title: "Thread navigation rework",
    boardStatus: "IMPLEMENTING",
    commitShas: ["abc1234", "def5678"],
    section: "active",
    boardRow: {
      questId: "q-968",
      title: "Thread navigation rework",
      worker: "worker-968",
      workerNum: 1321,
      status: "IMPLEMENTING",
      createdAt: 1,
      updatedAt: 2,
    },
    rowStatus: {
      worker: { sessionId: "worker-968", sessionNum: 1321, name: "Clear Mesa", status: "running" },
      reviewer: { sessionId: "reviewer-968", sessionNum: 1306, name: "Reviewer Long Name", status: "idle" },
    } satisfies BoardRowSessionStatus,
  };
}

describe("QuestThreadBanner commit affordance", () => {
  beforeEach(() => {
    mockSetActiveTab.mockClear();
  });

  it("keeps participant navigation accessible while shortening visible labels", () => {
    render(<QuestThreadBanner row={participantRow()} threadKey="q-968" />);

    const banner = screen.getByTestId("quest-thread-banner");
    expect(within(banner).getByLabelText("Worker #1321 Clear Mesa")).toHaveAttribute("href", "#session-1321");
    const reviewer = within(banner).getByLabelText("Reviewer #1306 Reviewer Long Name");
    expect(reviewer).toHaveAttribute("href", "#session-1306");
    expect(reviewer).toHaveAttribute("title", "Open reviewer session #1306 Reviewer Long Name");
    expect(banner).not.toHaveTextContent("Clear Mesa");
    expect(banner).not.toHaveTextContent("Reviewer Long Name");
  });

  it("removes or retargets the reviewer chip when the authoritative row status changes", () => {
    // These payload transitions mirror successive server-authored board_updated
    // messages after reviewer replacement and archival/removal.
    const original = participantRow();
    const view = render(<QuestThreadBanner row={original} threadKey="q-968" />);
    expect(screen.getByLabelText("Reviewer #1306 Reviewer Long Name")).toHaveAttribute("href", "#session-1306");

    const changed = participantRow();
    changed.rowStatus = {
      ...changed.rowStatus,
      reviewer: { sessionId: "reviewer-969", sessionNum: 1307, name: "Replacement Reviewer", status: "running" },
    };
    view.rerender(<QuestThreadBanner row={changed} threadKey="q-968" />);
    expect(screen.queryByLabelText("Reviewer #1306 Reviewer Long Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reviewer #1307 Replacement Reviewer")).toHaveAttribute("href", "#session-1307");

    const removed = participantRow();
    removed.rowStatus = { ...removed.rowStatus, reviewer: null };
    view.rerender(<QuestThreadBanner row={removed} threadKey="q-968" />);
    expect(screen.queryByLabelText(/^Reviewer #/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Worker #1321 Clear Mesa")).toHaveAttribute("href", "#session-1321");
  });

  it("shows a code-commit count chip that opens the Diff tab", () => {
    render(<QuestThreadBanner row={participantRow()} threadKey="q-968" />);

    const commitButton = screen.getByTestId("quest-thread-commit-button");
    expect(commitButton).toHaveTextContent("2 commits");
    expect(commitButton).toHaveAccessibleName("Open q-968 recorded commit diffs, 2 commits");

    fireEvent.click(commitButton);
    expect(mockSetActiveTab).toHaveBeenCalledWith("diff");
  });

  it("preserves the zero-commit affordance when no reviewer is assigned", () => {
    const row = participantRow();
    row.commitShas = [];
    row.rowStatus = { ...row.rowStatus, reviewer: null };
    render(<QuestThreadBanner row={row} threadKey="q-968" />);

    expect(screen.queryByLabelText(/^Reviewer #/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Worker #1321 Clear Mesa")).toBeInTheDocument();
    expect(screen.getByTestId("quest-thread-commit-button")).toHaveAccessibleName(
      "Open q-968 recorded commit diffs, 0 commits",
    );
  });
});
