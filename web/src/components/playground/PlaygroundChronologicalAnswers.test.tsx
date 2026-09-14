// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeaderThreadResponseState } from "../../../server/leader-thread-response.js";
import { useStore } from "../../store.js";
import {
  buildChronologicalAnswersWindow,
  chronologicalAnswersFixture as fixture,
} from "../../test-fixtures/chronological-answers.js";
import { PlaygroundChronologicalAnswers } from "./PlaygroundChronologicalAnswers.js";

vi.mock("../../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"chronology"' }) },
}));

const FIRST_REQUEST = "Please add a download action for the report.";
const LATER_QUESTION = "Should the downloaded file name include the date?";
const DESIGN_ANSWER = "Yes, include the date so downloaded reports are easy to distinguish.";
const IMPLEMENTATION_ANSWER = "The download action is implemented and ready.";

beforeEach(() => useStore.getState().reset());

function expectChronology(container: HTMLElement) {
  const rows = [FIRST_REQUEST, LATER_QUESTION, DESIGN_ANSWER, IMPLEMENTATION_ANSWER].map((text) => {
    const matches = within(container).getAllByText(text);
    expect(matches).toHaveLength(1);
    return matches[0]!;
  });
  for (let index = 1; index < rows.length; index++) {
    expect(rows[index - 1]!.compareDocumentPosition(rows[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

describe("chronological collapsed answers", () => {
  it("keeps the retained fixture aligned with server authority and bounded-window producers", () => {
    // Both answers retain exact request proof after a synthetic Main handoff.
    // The Main display has no coverage authority, and the latest one-item
    // window still carries both answer source rows and complete proof.
    const before = JSON.stringify(fixture.history);
    for (const threadKey of ["main", fixture.threadKey]) {
      const state = buildLeaderThreadResponseState(
        { id: fixture.sessionId, messageHistory: fixture.history },
        threadKey,
      ).projection;
      expect(state).toEqual(fixture.projections[threadKey]);
      for (const itemCount of [1, fixture.history.length]) {
        const sync = buildChronologicalAnswersWindow(threadKey, itemCount);
        expect(sync.threadResponseSupportComplete).toBe(true);
        expect(sync.threadResponseProjection?.currentAnswers.map((row) => row.currentMessageId)).toEqual([
          "chronology-design-answer",
          "chronology-implementation-answer",
        ]);
        expect(sync.entries.map((entry) => entry.history_index)).toEqual(
          sync.entries.map((entry) => entry.history_index).sort((a, b) => a - b),
        );
        expect(sync.threadResponseProjection?.currentAnswers.map((row) => row.coveredAnswerUserMessageIds)).toEqual(
          threadKey === "main" ? [[], []] : [["u2"], ["u1"]],
        );
      }
    }
    expect(JSON.stringify(fixture.history)).toBe(before);
  });

  it.each(["main", "quest"])("preserves source order and answer previews through %s collapse and expansion", (view) => {
    // The implementation answers the older request but was written after the
    // design answer. Prompt-anchored placement would invert these DOM rows.
    const before = JSON.stringify(fixture.history);
    render(<PlaygroundChronologicalAnswers />);
    const container = screen.getByTestId("playground-chronological-answers");
    if (view === "quest") fireEvent.click(within(container).getByRole("button", { name: "Quest" }));
    expectChronology(container);
    const sourceTurn = container.querySelector<HTMLElement>('[data-turn-id="chronology-u2"]')!;
    const firstTurn = container.querySelector<HTMLElement>('[data-turn-id="chronology-u1"]')!;
    expect(within(firstTurn).queryByText(IMPLEMENTATION_ANSWER)).not.toBeInTheDocument();
    expect(within(sourceTurn).getByText(IMPLEMENTATION_ANSWER)).toBeVisible();
    fireEvent.click(within(sourceTurn).getByRole("button", { name: /Show turn activity/ }));
    expectChronology(container);
    fireEvent.click(within(sourceTurn).getByRole("button", { name: /Hide turn activity/ }));
    expectChronology(container);
    const badges = within(sourceTurn).getAllByRole("button", {
      name: "Answers 1 message; preview referenced message",
    });
    fireEvent.click(badges[1]!);
    expect(screen.getByTestId("thread-response-coverage-preview")).toHaveTextContent(FIRST_REQUEST);
    expect(screen.getByTestId("thread-response-coverage-preview")).not.toHaveTextContent(LATER_QUESTION);
    fireEvent.keyDown(document, { key: "Escape" });
    expectChronology(container);
    expect(JSON.stringify(fixture.history)).toBe(before);
  });
});
