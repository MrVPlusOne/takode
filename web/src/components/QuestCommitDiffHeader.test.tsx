// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import type { QuestCommitDiffState } from "./QuestCommitDiffView.js";
import { QuestCommitDiffHeader } from "./QuestCommitDiffHeader.js";
import { commitLookupKey } from "./QuestCommitEvidence.js";

function stateFixture(): QuestCommitDiffState {
  const entries = [
    { kind: "code" as const, sha: "a".repeat(40), storedIndex: 0 },
    { kind: "memory" as const, sha: "b".repeat(40), storedIndex: 1 },
  ];
  const details = {
    sha: entries[0]!.sha,
    message: "Preserve an intentionally long commit title for inspection",
    available: true,
    additions: 12,
    deletions: 4,
    splitStats: { code: { additions: 8, deletions: 2 }, tests: { additions: 4, deletions: 2 } },
    comparison: { method: "first-parent-v1" as const, baseSha: "c".repeat(40), parentCount: 2 },
    recordedStats: { additions: 9, deletions: 2, binaryFiles: 0 },
  };
  return {
    commitEntries: entries,
    commitLookupByKey: { [commitLookupKey("code", details.sha)]: details },
    commitLookupLoadingKey: null,
    commitLookupError: "",
    activeCommitKey: commitLookupKey("code", details.sha),
    activeCommitIndex: 0,
    activeCommitEntry: entries[0]!,
    activeCommitDetails: details,
    openCommit: vi.fn(),
    closeCommit: vi.fn(),
    setActiveCommitKey: vi.fn(),
  };
}

describe("compact commit header", () => {
  it("keeps authoritative totals visible while qualifying saved counts in accessible details", () => {
    // Dense presentation must not relabel historical evidence or lose the full comparison/title.
    const state = stateFixture();
    const outerEscape = vi.fn();
    render(
      <div onKeyDown={outerEscape}>
        <QuestCommitDiffHeader state={state} fileNavigationRef={null} />
      </div>,
    );
    expect(screen.getByLabelText("Overall changes: 12 additions, 4 deletions")).toBeVisible();
    expect(screen.getByLabelText("Code changes: 8 additions, 2 deletions")).toBeVisible();
    expect(screen.getByLabelText("Tests changes: 4 additions, 2 deletions")).toBeVisible();
    expect(screen.getByTitle(state.activeCommitDetails!.message!)).toBeVisible();
    expect(screen.queryByTestId("quest-commit-recorded-stats")).toBeNull();
    const details = screen.getByRole("button", { name: "Details · saved counts differ" });
    fireEvent.click(details);
    expect(screen.getByTestId("quest-commit-recorded-stats")).toHaveTextContent("Saved chip counts: +9 −2");
    expect(screen.getByTestId("quest-commit-recorded-stats")).toHaveTextContent("Baseline unrecorded");
    expect(screen.getByTestId("quest-commit-comparison")).toHaveTextContent("may include existing layer code");
    expect(screen.getByRole("region", { name: "Commit details" })).toHaveTextContent(state.activeCommitEntry!.sha);
    fireEvent.keyDown(details, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Commit details" })).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();
    expect(details).toHaveFocus();
    fireEvent.click(details);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Commit details" })).toBeNull();
  });

  it("selects exact code/memory entries without an unbounded chip row and clears stale details", () => {
    // The selector uses kind plus SHA, preserving mixed evidence and selected-commit identity.
    const state = stateFixture();
    const view = render(<QuestCommitDiffHeader state={state} fileNavigationRef={null} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Select commit" }), {
      target: { value: commitLookupKey("memory", state.commitEntries[1]!.sha) },
    });
    expect(state.openCommit).toHaveBeenCalledWith(state.commitEntries[1]);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(state.openCommit).toHaveBeenCalledWith(state.commitEntries[1]);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    view.rerender(
      <QuestCommitDiffHeader
        state={{
          ...state,
          activeCommitKey: commitLookupKey("memory", state.commitEntries[1]!.sha),
          activeCommitEntry: state.commitEntries[1]!,
          activeCommitIndex: 1,
          activeCommitDetails: undefined,
        }}
        fileNavigationRef={null}
      />,
    );
    expect(screen.queryByRole("region", { name: "Commit details" })).toBeNull();
    expect(screen.getByText("Memory Commit")).toBeVisible();
  });

  it("does not show stale delivered totals while the review list is loading", () => {
    // Review mode changes the entry list before the hook's previous metadata is cleared.
    const state = { ...stateFixture(), commitEntries: [], activeCommitEntry: null, activeCommitIndex: -1 };
    render(
      <QuestCommitDiffHeader
        state={state}
        fileNavigationRef={null}
        commitLabel="Review commit"
        context={<button>Back to delivered commit</button>}
      />,
    );
    expect(screen.queryByTestId("quest-commit-diff-stats-overall")).toBeNull();
    expect(screen.queryByTestId("quest-commit-diff-stats")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to delivered commit" })).toBeVisible();
  });
});
