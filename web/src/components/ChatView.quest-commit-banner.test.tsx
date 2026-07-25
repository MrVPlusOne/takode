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
    children,
  }: {
    sessionNum?: number;
    ariaLabel?: string;
    dataTestId?: string;
    children?: ReactNode;
  }) => (
    <a href={"#session-" + sessionNum} aria-label={ariaLabel} data-testid={dataTestId}>
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
    expect(within(banner).getByLabelText("Reviewer #1306 Reviewer Long Name")).toHaveAttribute("href", "#session-1306");
    expect(banner).not.toHaveTextContent("Clear Mesa");
    expect(banner).not.toHaveTextContent("Reviewer Long Name");
  });

  it("shows a code-commit count chip that opens the Diff tab", () => {
    render(<QuestThreadBanner row={participantRow()} threadKey="q-968" />);

    const commitButton = screen.getByTestId("quest-thread-commit-button");
    expect(commitButton).toHaveTextContent("2 commits");
    expect(commitButton).toHaveAccessibleName("Open q-968 recorded commit diffs, 2 commits");

    fireEvent.click(commitButton);
    expect(mockSetActiveTab).toHaveBeenCalledWith("diff");
  });
});
