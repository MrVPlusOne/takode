// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ sendToSession: vi.fn(() => true) }));
vi.mock("../ws.js", () => ({ sendToSession: ws.sendToSession }));
// Answer drafts go to the draft sync; here only what this tab holds matters.
vi.mock("../draft-sync.js", () => ({ flushPendingDrafts: vi.fn() }));
const apiMock = vi.hoisted(() => ({ getGuidedReviewCommit: vi.fn() }));
vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return { ...actual, api: { ...actual.api, getGuidedReviewCommit: apiMock.getGuidedReviewCommit } };
});

import { MarkdownReport } from "./MarkdownReport.js";
import { GuidedReviewViewerHost } from "./GuidedReviewViewer.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { formatGuidedReviewAnswers, useGuidedReviewState } from "../guided-review-state.js";
import {
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

async function openTour() {
  renderReview();
  fireEvent.click(within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Start the review" }));
  return screen.findByTestId("guided-review-viewer");
}

describe("guided review", () => {
  beforeEach(() => {
    useGuidedReviewState.setState({ open: null, drafts: {}, reviewSessions: {} });
    ws.sendToSession.mockClear();
    apiMock.getGuidedReviewCommit.mockReset();
  });

  it("shows the review as a card in the feed instead of its Markdown version", () => {
    renderReview();
    const card = screen.getByTestId("guided-review-card");
    expect(card).toHaveTextContent("Retry profile loads and cache profiles");
    expect(card).toHaveTextContent("2 questions for you · 1 to look at · 1 checked · 2 summarized");
    expect(card).toHaveTextContent("All 27 changed lines accounted for: 20 shown as code, 7 summarized");
    expect(screen.queryByText("# Guided review: Retry profile loads and cache profiles")).toBeNull();
  });

  it("is one tour: overview, stops with their saved code and inline answers, then checked and summarized", async () => {
    const viewer = await openTour();
    expect(within(viewer).queryByRole("tab")).toBeNull();
    expect(viewer).toHaveTextContent("Adds a retry helper and uses it for profile loads");
    const stops = within(viewer).getAllByTestId("guided-review-stop");
    // Questions first, then careful looks; checked stops sit in their own foldable list.
    expect(stops.map((stop) => within(stop).getByText(/^Stop \d$/).textContent)).toEqual([
      "Stop 1",
      "Stop 2",
      "Stop 3",
    ]);
    expect(stops[0]).toHaveTextContent("Retry every error up to 4 times?");
    // The code comes from the snippet saved with the review; nothing is fetched to show it.
    expect(stops[2]).toHaveTextContent("PROFILE_TIMEOUT_MS = 15_000");
    expect(apiMock.getGuidedReviewCommit).not.toHaveBeenCalled();

    const checked = within(viewer).getByRole("button", { name: /The helper's comment/ });
    expect(checked).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(checked);
    expect(checked).toHaveAttribute("aria-expanded", "true");
    expect(viewer).toHaveTextContent("Matches what the code does.");
    expect(viewer).toHaveTextContent("Summarized (2)");
  });

  it("fills one answer field from the suggestions, keeps typing while Escape is pressed in it, and sends once", async () => {
    const viewer = await openTour();
    const [first, second, check] = within(viewer).getAllByTestId("guided-review-stop");
    fireEvent.click(within(first).getByRole("button", { name: "Only network errors" }));
    expect(within(first).getByRole("textbox")).toHaveValue("Only network errors");
    fireEvent.change(within(second).getByRole("textbox"), { target: { value: "One hour; clear it on edit." } });
    fireEvent.click(within(check).getByRole("button", { name: "Question" }));

    // Escape inside an answer field leaves the review open.
    fireEvent.keyDown(within(second).getByRole("textbox"), { key: "Escape" });
    expect(screen.getByTestId("guided-review-viewer")).toBeInTheDocument();

    expect(within(viewer).getByText("2 of 2 answered")).toBeInTheDocument();
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
        "   Answer: One hour; clear it on edit.",
        "",
        "On other stops:",
        '- "Timeout tripled to 15 seconds": Question',
      ].join("\n"),
      threadKey: "q-42",
      questId: "q-42",
      inputSource: "composer",
      session_id: "review-host",
    });
    // Sending closes the review; it is marked sent, so it can't be sent again.
    expect(screen.queryByTestId("guided-review-viewer")).toBeNull();
    expect(useGuidedReviewState.getState().drafts["review-fixture"]?.sentAt).toEqual(expect.any(Number));
    fireEvent.click(within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Open review" }));
    const reopened = await screen.findByTestId("guided-review-viewer");
    expect(within(reopened).queryByRole("button", { name: "Send answers" })).toBeNull();
    expect(reopened).toHaveTextContent("Your answer: Only network errors");
  });

  it("opens the full change commit by commit from git", async () => {
    apiMock.getGuidedReviewCommit.mockResolvedValue({
      sha: "c".repeat(40),
      shortSha: "ccccccc",
      message: "feat(client): retry profile loads",
      available: true,
      diff: 'diff --git a/src/retry.test.ts b/src/retry.test.ts\n--- /dev/null\n+++ b/src/retry.test.ts\n@@ -0,0 +1 @@\n+import { expect, it } from "vitest";\n',
    });
    const viewer = await openTour();
    fireEvent.click(within(viewer).getByRole("button", { name: "Full diff" }));
    const full = await screen.findByTestId("guided-review-full-diff");
    await waitFor(() =>
      expect(apiMock.getGuidedReviewCommit).toHaveBeenCalledWith("review-host", "review-fixture", "c".repeat(40), {
        includeDiff: true,
      }),
    );
    await waitFor(() => expect(full).toHaveTextContent('import { expect, it } from "vitest";'));
  });
});

describe("formatGuidedReviewAnswers", () => {
  it("keeps multi-line answers readable and marks unanswered questions", () => {
    const text = formatGuidedReviewAnswers(makeGuidedReviewMetaFixture(), { 1: "One hour.\nAnd clear on edit." });
    expect(text.split("\n").slice(2)).toEqual([
      "1. Retry every error up to 4 times?",
      "   Answer: not answered",
      "",
      "2. Cache profiles for a day?",
      "   Answer: One hour.",
      "   And clear on edit.",
    ]);
  });
});
