// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { DiffChip, DiffChipButton, SessionChangesChip, SessionDiffBanner } from "./DiffChip.js";
import type { SessionDiffSummary } from "../utils/session-diff-summary.js";

const NO_CHANGES: SessionDiffSummary = { linesAdded: 0, linesRemoved: 0, changedFiles: 0 };
const mockOpenDiffView = vi.fn();

function renderButton(commitCount: number | null, changes: SessionDiffSummary = NO_CHANGES) {
  return render(<DiffChipButton commitCount={commitCount} changes={changes} title="Show diff" onOpen={() => {}} />);
}

describe("DiffChipButton label", () => {
  // The label must say at a glance whether there are commits, changes, both or nothing, in a few
  // characters that fit a phone banner row.
  it("shows commits, changes, both, or an explicit empty state", () => {
    const { unmount } = renderButton(2);
    expect(screen.getByTestId("diff-chip")).toHaveTextContent(/^2 commits$/);
    unmount();

    const changesOnly = renderButton(0, { linesAdded: 120, linesRemoved: 8, changedFiles: 0 });
    expect(screen.getByTestId("diff-chip")).toHaveTextContent(/^\+120-8$/);
    expect(screen.queryByTestId("diff-chip-commits")).not.toBeInTheDocument();
    changesOnly.unmount();

    const both = renderButton(2, { linesAdded: 1234, linesRemoved: 8, changedFiles: 0 });
    expect(screen.getByTestId("diff-chip")).toHaveTextContent("2 commits·+1.2k-8");
    expect(screen.getByTestId("diff-chip")).toHaveAccessibleName(
      "Show diff: 2 commits, 1234 lines added and 8 removed",
    );
    both.unmount();

    const empty = renderButton(0);
    expect(screen.getByTestId("diff-chip")).toHaveTextContent(/^No commits$/);
    expect(screen.getByTestId("diff-chip")).toHaveClass("text-cc-muted");
    empty.unmount();

    renderButton(null, { linesAdded: 0, linesRemoved: 0, changedFiles: 3 });
    expect(screen.getByTestId("diff-chip")).toHaveTextContent(/^3 files$/);
  });

  // q-2423 precedent: counts are plain text inside the control, never a corner badge that reads as unread.
  it("never draws the count as a corner badge", () => {
    renderButton(5, { linesAdded: 4, linesRemoved: 1, changedFiles: 0 });
    const chip = screen.getByTestId("diff-chip");
    expect(chip.querySelector(".absolute")).toBeNull();
    expect(chip.querySelector(".rounded-full")).toBeNull();
  });
});

describe("DiffChip wired to the store", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ openDiffView: mockOpenDiffView });
    mockOpenDiffView.mockClear();
  });

  it("shows a worker's quest commits and its own changes, and opens that diff", () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "worker",
        sessionNum: 5,
        state: "connected",
        cwd: "/wt/worker",
        createdAt: 1,
        isWorktree: true,
        totalLinesAdded: 12,
        totalLinesRemoved: 3,
        claimedQuestId: "q-7",
        claimedQuestStatus: "in_progress",
      },
    ]);
    useStore.getState().upsertQuestTitlePreview({
      questId: "q-7",
      title: "Example",
      version: 1,
      updatedAt: 1,
      commitShas: ["abc1234"],
    });

    render(<DiffChip sessionId="worker" threadKey="main" />);

    const chip = screen.getByTestId("diff-chip");
    expect(chip).toHaveTextContent("1 commit·+12-3");
    fireEvent.click(chip);
    expect(mockOpenDiffView).toHaveBeenCalledWith("worker", "main");
  });

  it("hides the leader's Main chip while its checkout is clean and shows it once it has changes", () => {
    const leader = { sessionId: "leader", sessionNum: 1, state: "connected" as const, cwd: "/repo", createdAt: 1 };
    useStore.getState().setSdkSessions([{ ...leader, isOrchestrator: true }]);
    const { rerender } = render(<SessionChangesChip sessionId="leader" threadKey="main" title="Show leader changes" />);
    expect(screen.queryByTestId("diff-chip")).not.toBeInTheDocument();

    useStore.getState().addChangedFile("leader", "/repo/src/a.ts");
    rerender(<SessionChangesChip sessionId="leader" threadKey="main" title="Show leader changes" />);
    expect(screen.getByTestId("diff-chip")).toHaveTextContent(/^1 file$/);
    expect(screen.getByTestId("diff-chip")).toHaveAttribute("title", "Show leader changes");
  });
});

describe("SessionDiffBanner", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ openDiffView: mockOpenDiffView });
    mockOpenDiffView.mockClear();
  });

  // A session without a quest still needs a way to open its diff once the top-bar button is gone.
  it("appears only while a session without a quest has changes", () => {
    useStore
      .getState()
      .setSdkSessions([
        { sessionId: "s1", sessionNum: 3, state: "connected", cwd: "/wt/s1", createdAt: 1, isWorktree: true },
      ]);
    const { rerender } = render(<SessionDiffBanner sessionId="s1" />);
    expect(screen.queryByTestId("session-diff-banner")).not.toBeInTheDocument();

    useStore.getState().setSdkSessions([
      {
        sessionId: "s1",
        sessionNum: 3,
        state: "connected",
        cwd: "/wt/s1",
        createdAt: 1,
        isWorktree: true,
        totalLinesAdded: 40,
        totalLinesRemoved: 0,
      },
    ]);
    rerender(<SessionDiffBanner sessionId="s1" />);
    const banner = screen.getByTestId("session-diff-banner");
    const chip = within(banner).getByTestId("diff-chip");
    expect(chip).toHaveTextContent("+40-0");
    fireEvent.click(chip);
    expect(mockOpenDiffView).toHaveBeenCalledWith("s1", "main");
  });
});
