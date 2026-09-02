// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi } from "vitest";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestOutcomeState, QuestmasterTask } from "../types.js";
import { QuestOutcomeCard } from "./QuestOutcomeCard.js";

function outcome(): QuestOutcomeState {
  return {
    currentRevisionId: "r2",
    revisions: [
      {
        revisionId: "r1",
        markdown: "## Earlier\n\nEarlier result.",
        summaryMarkdown: "Earlier result.",
        summarySource: "derived",
        contentHash: "h1",
        createdAt: 1,
        actor: { kind: "leader", sessionId: "leader" },
        anchor: { sessionId: "leader", historyIndex: 2, messageId: "a1" },
        sources: [],
      },
      {
        revisionId: "r2",
        parentRevisionId: "r1",
        markdown: "## Current\n\nCurrent **useful** result.",
        summaryMarkdown: "Current useful result.",
        summarySource: "derived",
        contentHash: "h2",
        createdAt: 2,
        actor: { kind: "human" },
        anchor: { sessionId: "leader", historyIndex: 5, messageId: "a2" },
        sources: [],
      },
    ],
  };
}

function outcomeWithNewerRevision(markdown = "Latest server result."): QuestOutcomeState {
  const next = outcome();
  next.currentRevisionId = "r3";
  next.revisions.push({
    ...next.revisions[1]!,
    revisionId: "r3",
    parentRevisionId: "r2",
    markdown,
    summaryMarkdown: "Latest server result.",
    createdAt: 3,
  });
  return next;
}

function questWith(nextOutcome: QuestOutcomeState): QuestmasterTask {
  return {
    id: "q-42",
    questId: "q-42",
    version: 2,
    title: "Outcome test",
    description: "Test",
    status: "in_progress",
    sessionId: "worker",
    claimedAt: 1,
    createdAt: 1,
    outcome: nextOutcome,
  };
}

describe("QuestOutcomeCard", () => {
  beforeEach(() => {
    useStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("shows one latest card, newer-activity context, and collapsed prior versions", () => {
    render(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={outcome()}
        sessionId="leader"
        newerActivityBelow
        showQuiz={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Current Outcome" })).toBeVisible();
    expect(screen.getByText("Current", { selector: "h2, h1, h3" })).toBeVisible();
    expect(screen.getByText("Newer activity follows")).toBeVisible();
    expect(screen.getByTestId("quest-outcome-versions")).not.toHaveAttribute("open");
    expect(screen.queryByText("Earlier result.")).toBeNull();

    fireEvent.click(within(screen.getByTestId("quest-outcome-versions")).getByText("Versions"));
    expect(screen.getByText(/Version 1/)).toBeVisible();
  });

  it("keeps an open Versions disclosure populated across a newer revision", () => {
    const initial = outcome();
    const view = render(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={initial}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );
    fireEvent.click(within(screen.getByTestId("quest-outcome-versions")).getByText("Versions"));
    expect(screen.getByText(/Version 1/)).toBeVisible();

    const next = outcome();
    next.currentRevisionId = "r3";
    next.revisions.push({ ...next.revisions[1]!, revisionId: "r3", parentRevisionId: "r2", createdAt: 3 });
    view.rerender(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={next}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );

    expect(screen.getByTestId("quest-outcome-versions")).toHaveAttribute("open");
    expect(screen.getByText(/Version 2/)).toBeVisible();
  });

  it("creates a CAS revision and advances the boundary only after explicit opt-in", async () => {
    const next = outcome();
    next.currentRevisionId = "r3";
    next.revisions.push({
      ...next.revisions[1]!,
      revisionId: "r3",
      parentRevisionId: "r2",
      markdown: "Updated result.",
      createdAt: 3,
    });
    const update = vi.spyOn(api, "updateQuestOutcome").mockResolvedValue({
      quest: questWith(next),
      outcome: next,
    });

    render(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={outcome()}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Outcome Markdown"), { target: { value: "Updated result." } });
    const move = screen.getByRole("checkbox", { name: /Move this card after the latest activity/ });
    expect(move).not.toBeChecked();
    fireEvent.click(move);
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      baseRevisionId: "r2",
      markdown: "Updated result.",
      advanceThroughSessionId: "leader",
    });
  });

  it("preserves a dirty editor when a newer revision arrives and keeps the original CAS base", async () => {
    const update = vi.spyOn(api, "updateQuestOutcome").mockRejectedValue(new Error("Outcome changed"));
    const initial = outcome();
    const { rerender } = render(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={initial}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Outcome Markdown"), { target: { value: "Unsaved local draft." } });

    rerender(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={outcomeWithNewerRevision()}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );

    expect(screen.getByLabelText("Outcome Markdown")).toHaveValue("Unsaved local draft.");
    expect(screen.getByText(/A newer Outcome version is available/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Load latest version" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      baseRevisionId: "r2",
      markdown: "Unsaved local draft.",
    });
  });

  it("loads the latest authoritative revision explicitly before saving against its CAS base", async () => {
    const latest = outcomeWithNewerRevision();
    const update = vi.spyOn(api, "updateQuestOutcome").mockResolvedValue({
      quest: questWith(latest),
      outcome: latest,
    });
    const { rerender } = render(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={outcome()}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Outcome Markdown"), { target: { value: "Unsaved local draft." } });
    rerender(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="in_progress"
        outcome={latest}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load latest version" }));
    expect(screen.getByLabelText("Outcome Markdown")).toHaveValue("Latest server result.");

    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      baseRevisionId: "r3",
      markdown: "Latest server result.",
    });
  });

  it("renders the authoritative sibling quiz for a completed Outcome", () => {
    render(
      <QuestOutcomeCard
        questId="q-42"
        questTitle="Outcome test"
        questStatus="done"
        outcome={outcome()}
        sessionId="leader"
        newerActivityBelow={false}
        showQuiz
        quizItems={[{ id: "quiz", question: "What moved?", answer: "The Outcome card." }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Outcome" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Quest quiz" })).toBeVisible();
  });
});
