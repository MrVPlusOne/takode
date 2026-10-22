// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ sendToSession: vi.fn(() => true) }));
vi.mock("../ws.js", () => ({ sendToSession: ws.sendToSession }));

import { MarkdownReport } from "./MarkdownReport.js";
import { GuidedReviewViewerHost } from "./GuidedReviewViewer.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { formatGuidedReviewAnswers, useGuidedReviewState } from "../guided-review-state.js";
import {
  GUIDED_REVIEW_FIXTURE_DIFF,
  makeGuidedReviewMetaFixture,
  makeGuidedReviewReportFixture,
} from "../../shared/test-fixtures/guided-review.js";

// The feed message is built from the published history entry, as the browser receives it.
const [message] = normalizeHistoryMessageToChatMessages(makeGuidedReviewReportFixture(), 7);

function renderReview() {
  return render(
    <>
      <MarkdownReport message={message} />
      <GuidedReviewViewerHost />
    </>,
  );
}

describe("guided review", () => {
  beforeEach(() => {
    useGuidedReviewState.setState({ open: null, mode: "questions", answers: {}, sent: {} });
    ws.sendToSession.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ diff: GUIDED_REVIEW_FIXTURE_DIFF }), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the review as a card in the feed instead of its Markdown version", () => {
    renderReview();
    const card = screen.getByTestId("guided-review-card");
    expect(card).toHaveTextContent("Retry profile loads and cache profiles");
    expect(card).toHaveTextContent("2 questions for you · 1 to look at · 1 checked · 2 summarized");
    expect(card).toHaveTextContent("All 27 changed lines accounted for: 20 shown as code, 7 summarized");
    expect(screen.queryByText("# Guided review: Retry profile loads and cache profiles")).toBeNull();
  });

  it("opens on the questions, shows a question's code from the diff, and sends the answers to the thread", async () => {
    renderReview();
    fireEvent.click(within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Answer 2" }));
    const viewer = await screen.findByTestId("guided-review-viewer");
    expect(within(viewer).getByRole("tab", { name: "Questions · 2" })).toHaveAttribute("aria-selected", "true");

    // Code is drawn from the fetched diff on demand, cut to the stop's lines.
    fireEvent.click(within(viewer).getByRole("button", { name: "See the code (retry.ts)" }));
    await waitFor(() => expect(viewer).toHaveTextContent("2 ** attempt * 500"));
    expect(fetch).toHaveBeenCalledWith("/api/guided-reviews/review-fixture");

    fireEvent.click(within(viewer).getByRole("button", { name: "Only network errors" }));
    fireEvent.click(within(viewer).getAllByRole("button", { name: "Add a note" })[1]);
    fireEvent.change(within(viewer).getByPlaceholderText("Add a note for the agent"), {
      target: { value: "Clear it on edit." },
    });
    expect(within(viewer).getByText("1 of 2 answered")).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole("button", { name: "Send answers" }));

    expect(ws.sendToSession).toHaveBeenCalledWith("review-host", {
      type: "user_message",
      content: [
        "Guided review answers: Retry profile loads and cache profiles",
        "",
        "1. Retry every error up to 4 times?",
        "   Answer: Only network errors",
        "",
        "2. Cache profiles for a day?",
        "   Answer: not answered",
        "   Note: Clear it on edit.",
      ].join("\n"),
      threadKey: "q-42",
      questId: "q-42",
      inputSource: "composer",
      session_id: "review-host",
    });
    // Sending closes the review and the card remembers it.
    expect(screen.queryByTestId("guided-review-viewer")).toBeNull();
    expect(
      within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Answers sent" }),
    ).toBeVisible();
  });

  it("shows the tour with every stop's code, and the raw diff one tap away", async () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Full tour" }));
    const viewer = await screen.findByTestId("guided-review-viewer");
    expect(within(viewer).getByRole("tab", { name: "Tour · 4" })).toHaveAttribute("aria-selected", "true");
    expect(within(viewer).getByText("Stop 3")).toBeInTheDocument();
    await waitFor(() => expect(viewer).toHaveTextContent("PROFILE_TIMEOUT_MS = 15_000"));

    act(() => {
      fireEvent.click(within(viewer).getByRole("tab", { name: "Diff · 3" }));
    });
    expect(within(viewer).getAllByText(/retry\.test\.ts/).length).toBeGreaterThan(0);
    expect(within(viewer).queryByRole("button", { name: "Send answers" })).toBeNull();
  });
});

describe("formatGuidedReviewAnswers", () => {
  it("lists reactions and notes on stops that are not questions", () => {
    const text = formatGuidedReviewAnswers(makeGuidedReviewMetaFixture(), {
      2: { choice: "Change", note: "Keep 5 seconds." },
      3: { note: "Fine." },
    });
    expect(text.split("\n").slice(-6)).toEqual([
      "",
      "On other stops:",
      '- "Timeout tripled to 15 seconds": Change',
      "  Note: Keep 5 seconds.",
      '- "The helper\'s comment": note',
      "  Note: Fine.",
    ]);
  });
});
