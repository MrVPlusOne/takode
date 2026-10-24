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
import { useStore } from "../store.js";
import { GuidedReviewViewerHost } from "./GuidedReviewViewer.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { formatGuidedReviewAnswers, useGuidedReviewState } from "../guided-review-state.js";
import {
  makeGuidedReviewMetaFixture,
  makeGuidedReviewReportFixture,
} from "../../shared/test-fixtures/guided-review.js";
import type { GuidedReviewMeta } from "../../shared/guided-review.js";

// The feed message is built from the published history entry, as the browser receives it.
function reviewMessage(change?: (meta: GuidedReviewMeta) => void) {
  const report = makeGuidedReviewReportFixture();
  change?.(report.guidedReview!);
  return normalizeHistoryMessageToChatMessages(report, 7)[0];
}

function renderReview(message = reviewMessage()) {
  return render(
    <>
      <MarkdownReport message={message} />
      <GuidedReviewViewerHost />
    </>,
  );
}

async function openTour(message?: ReturnType<typeof reviewMessage>) {
  renderReview(message);
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
    // The card says, for someone new to it, that an agent did the reading and what is left for them.
    expect(card).toHaveTextContent("An agent read all 27 changed lines and sorted them by what they need from you");
    expect(tileTexts(card)).toEqual([
      "2 decisions for you 16 lines",
      "1 to look at 3 lines",
      "1 checked by the agent 1 line",
      "2 summarized 7 lines",
    ]);
    // The feed card's tiles only describe; the review opens from its button.
    expect(within(card).queryByRole("button", { name: /decisions for you/ })).toBeNull();
    expect(screen.queryByText("# Guided review: Retry profile loads and cache profiles")).toBeNull();
  });

  it("walks through one stop at a time: overview, each stop with its saved code, then the wrap-up", async () => {
    const viewer = await openTour();
    const walkthrough = within(viewer).getByTestId("guided-review-walkthrough");
    // The overview comes first: what the agent did, the counts, and its summary of the change.
    expect(walkthrough).toHaveTextContent("An agent read all 27 changed lines");
    expect(walkthrough).toHaveTextContent("Adds a retry helper and uses it for profile loads");
    expect(within(viewer).queryByTestId("guided-review-stop")).toBeNull();

    fireEvent.click(within(viewer).getByRole("button", { name: "Start the walkthrough" }));
    // Decisions come first, then careful looks; each stop shows the code saved with the review.
    expect(currentStop(viewer)).toHaveTextContent("Retry every error up to 4 times?");
    expect(currentStop(viewer)).toHaveTextContent("export async function withRetry");
    expect(within(viewer).getByText("Stop 1 of 3")).toBeInTheDocument();
    expect(railSegment(viewer, 0)).toHaveAttribute("aria-current", "step");
    fireEvent.click(within(viewer).getByRole("button", { name: "Next" }));
    expect(currentStop(viewer)).toHaveTextContent("Cache profiles for a day?");
    fireEvent.click(within(viewer).getByRole("button", { name: "Next" }));
    expect(currentStop(viewer)).toHaveTextContent("Timeout tripled to 15 seconds");
    expect(currentStop(viewer)).toHaveTextContent("PROFILE_TIMEOUT_MS = 15_000");
    expect(apiMock.getGuidedReviewCommit).not.toHaveBeenCalled();

    // The last stop leads to the wrap-up: the answers so far, then what was checked and summarized.
    fireEvent.click(within(viewer).getByRole("button", { name: "Wrap up" }));
    expect(within(viewer).queryByTestId("guided-review-stop")).toBeNull();
    expect(viewer).toHaveTextContent("Your answers");
    fireEvent.click(within(viewer).getByRole("button", { name: /The helper's comment/ }));
    expect(viewer).toHaveTextContent("Matches what the code does.");
    expect(viewer).toHaveTextContent("Summarized (2)");
    fireEvent.click(within(viewer).getByRole("button", { name: "Back" }));
    expect(currentStop(viewer)).toHaveTextContent("Timeout tripled to 15 seconds");
  });

  it("moves with the arrow keys, the progress rail, a swipe and the count tiles", async () => {
    const viewer = await openTour();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(currentStop(viewer)).toHaveTextContent("Retry every error up to 4 times?");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(currentStop(viewer)).toHaveTextContent("Cache profiles for a day?");
    // Arrow keys inside an answer field move the cursor, not the walkthrough.
    fireEvent.keyDown(within(currentStop(viewer)).getByRole("textbox"), { key: "ArrowRight" });
    expect(currentStop(viewer)).toHaveTextContent("Cache profiles for a day?");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(currentStop(viewer)).toHaveTextContent("Retry every error up to 4 times?");

    fireEvent.click(railSegment(viewer, 2));
    expect(currentStop(viewer)).toHaveTextContent("Timeout tripled to 15 seconds");

    // A horizontal swipe turns the page; one that starts on code scrolls the code instead.
    const walkthrough = within(viewer).getByTestId("guided-review-walkthrough");
    swipe(walkthrough, walkthrough, 100, 300);
    expect(currentStop(viewer)).toHaveTextContent("Cache profiles for a day?");
    swipe(walkthrough, within(viewer).getAllByTestId("guided-review-snippet")[0], 100, 300);
    expect(currentStop(viewer)).toHaveTextContent("Cache profiles for a day?");
    swipe(walkthrough, walkthrough, 300, 100);
    expect(currentStop(viewer)).toHaveTextContent("Timeout tripled to 15 seconds");

    // From the overview, a count tile opens the first stop of its kind.
    for (let n = 0; n < 3; n++) fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.click(within(viewer).getByRole("button", { name: /to look at/ }));
    expect(currentStop(viewer)).toHaveTextContent("Timeout tripled to 15 seconds");
  });

  it("fills one answer field from the suggestions, keeps typing while Escape is pressed in it, and sends once", async () => {
    const viewer = await openTour();
    fireEvent.click(within(viewer).getByRole("button", { name: "Start the walkthrough" }));
    fireEvent.click(within(currentStop(viewer)).getByRole("button", { name: "Only network errors" }));
    expect(within(currentStop(viewer)).getByRole("textbox")).toHaveValue("Only network errors");
    // An answered stop's rail segment is filled; unanswered ones stay faint.
    expect(railSegment(viewer, 0).firstElementChild?.className).not.toContain("opacity-30");
    expect(railSegment(viewer, 1).firstElementChild?.className).toContain("opacity-30");
    fireEvent.click(within(viewer).getByRole("button", { name: "Next" }));
    const second = within(currentStop(viewer)).getByRole("textbox");
    fireEvent.change(second, { target: { value: "One hour; clear it on edit." } });
    // Escape inside an answer field leaves the review open.
    fireEvent.keyDown(second, { key: "Escape" });
    expect(screen.getByTestId("guided-review-viewer")).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole("button", { name: "Next" }));
    // Stops without a question offer only "Looks right"; questions and changes are typed.
    expect(within(currentStop(viewer)).queryByRole("button", { name: "Question" })).toBeNull();
    expect(within(currentStop(viewer)).queryByRole("button", { name: "Change" })).toBeNull();
    fireEvent.click(within(currentStop(viewer)).getByRole("button", { name: "Looks right" }));
    fireEvent.click(within(viewer).getByRole("button", { name: "Wrap up" }));
    expect(viewer).toHaveTextContent("Only network errors");
    // The wrap-up has a box for a message about the whole review, sent with the answers.
    fireEvent.change(
      within(within(viewer).getByTestId("guided-review-message")).getByRole("textbox", {
        name: "Message about the whole review",
      }),
      { target: { value: "Just answer; I'll make the changes myself." } },
    );

    expect(within(viewer).getByText("2 of 2 answered")).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole("button", { name: "Send answers" }));
    expect(ws.sendToSession).toHaveBeenCalledWith("review-host", {
      type: "user_message",
      content: [
        "Guided review answers: Retry profile loads and cache profiles",
        "",
        "Message about the whole review:",
        "> Just answer; I'll make the changes myself.",
        "",
        "1. Retry every error up to 4 times?",
        "   Answer: Only network errors",
        "",
        "2. Cache profiles for a day?",
        "   Answer: One hour; clear it on edit.",
        "",
        "On other stops:",
        '- "Timeout tripled to 15 seconds": Looks right',
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
    // A sent review reopens on its wrap-up, listing the answers that were sent.
    expect(reopened).toHaveTextContent("Your answers");
    expect(reopened).toHaveTextContent("Only network errors");
    expect(within(reopened).getByTestId("guided-review-message")).toHaveTextContent(
      "Just answer; I'll make the changes myself.",
    );
  });

  it("renders Takode links in the overview, explanations, summaries and sent answers, as chat does", async () => {
    // Reviews are read in Takode, so quest, session and file links work as they do in chat.
    const viewer = await openTour(
      reviewMessage((meta) => {
        meta.map.overview += " It follows [q-2813](quest:q-2813).";
        meta.map.stops[0].note += " Asked for in [#5](session:5).";
        meta.map.summaries[1].text += " See [retry.test.ts](file:src/retry.test.ts).";
      }),
    );
    const walkthrough = within(viewer).getByTestId("guided-review-walkthrough");
    expect(walkthrough.querySelector(".cc-quest-link")).toHaveTextContent("q-2813");
    expect(walkthrough).not.toHaveTextContent("quest:q-2813");
    // Quest links carry the chat feed's thread icon, which closes the review when it jumps.
    expect(within(walkthrough).getByTestId("quest-feed-preview-button")).toBeInTheDocument();

    fireEvent.click(within(viewer).getByRole("button", { name: "Start the walkthrough" }));
    expect(currentStop(viewer)).toHaveTextContent("Asked for in #5.");
    expect(currentStop(viewer)).not.toHaveTextContent("session:5");
    fireEvent.change(within(currentStop(viewer)).getByRole("textbox"), {
      target: { value: "Only network errors, as in [q-7](quest:q-7)" },
    });

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(viewer).toHaveTextContent("See retry.test.ts.");
    expect(viewer).not.toHaveTextContent("file:src/retry.test.ts");

    // Once sent, an answer shows as Markdown on its stop.
    fireEvent.click(within(viewer).getByRole("button", { name: "Send answers" }));
    fireEvent.click(within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Open review" }));
    const reopened = await screen.findByTestId("guided-review-viewer");
    fireEvent.click(within(reopened).getByRole("button", { name: /^Retry every error up to 4 times\?/ }));
    expect(currentStop(reopened).querySelector(".cc-quest-link")).toHaveTextContent("q-7");
  });

  it("lists each summarized area's files with the lines it covers, counted from the diff", async () => {
    const viewer = await openTour();
    for (let n = 0; n < 4; n++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    // The client's other changes are in stops, which its row says; the test file is all summarized.
    expect(fileRows(viewer, "Import")).toEqual(["client.ts src also in stops +1 −0"]);
    expect(fileRows(viewer, "Tests")).toEqual(["retry.test.ts src +6 −0"]);
  });

  it("lists only the paths of a review published before the counts existed", async () => {
    const viewer = await openTour(
      reviewMessage((meta) => {
        for (const summary of meta.map.summaries) delete summary.files;
      }),
    );
    for (let n = 0; n < 4; n++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(fileRows(viewer, "Tests")).toEqual(["retry.test.ts src"]);
  });

  it("closes when a link inside it opens a session, which it would otherwise cover", async () => {
    // A session or message link navigates the app behind the full-window review; the review
    // closes so the user sees where the link went, as file viewers do.
    useStore.setState({ sdkSessions: [{ sessionId: "worker-5", sessionNum: 5, archived: false } as never] });
    const viewer = await openTour(
      reviewMessage((meta) => {
        meta.map.overview += " Built by [#5](session:5).";
      }),
    );
    fireEvent.click(within(viewer).getByRole("link", { name: "#5" }));
    // The review's back-gesture entry is removed first, then the link is followed.
    await waitFor(() => expect(screen.queryByTestId("guided-review-viewer")).toBeNull());
    expect(window.location.hash).toContain("/session/");
  });

  it("leaves Escape to a quest or other modal opened over it", async () => {
    // A link in the review can open quest details above it; Escape closes those, not the review.
    const viewer = await openTour();
    const quest = document.body.appendChild(document.createElement("div"));
    quest.setAttribute("aria-modal", "true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(viewer).toBeInTheDocument();
    quest.remove();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("guided-review-viewer")).toBeNull();
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

/** A summary's file rows, with spaces between the name, folder, note and counts. */
function fileRows(viewer: HTMLElement, summaryTitle: string): string[] {
  const list = within(viewer).getByRole("list", { name: `Files in ${summaryTitle}` });
  return within(list)
    .getAllByRole("listitem")
    .map((row) =>
      [...row.querySelectorAll("span")]
        .filter((part) => !part.querySelector("span"))
        .map((part) => part.textContent?.trim())
        .join(" "),
    );
}

/** The stop the walkthrough shows now. */
function currentStop(viewer: HTMLElement): HTMLElement {
  return within(viewer).getByTestId("guided-review-stop");
}

/** The progress rail's segment for the n-th stop of the walkthrough (from 0). */
function railSegment(viewer: HTMLElement, n: number): HTMLElement {
  return within(within(viewer).getByTestId("guided-review-rail")).getAllByRole("button")[n];
}

/** A one-finger horizontal swipe from `fromX` to `toX` that starts on `start` and ends on `container`. */
function swipe(container: HTMLElement, start: HTMLElement, fromX: number, toX: number) {
  fireEvent.touchStart(start, { touches: [{ clientX: fromX, clientY: 200 }] });
  fireEvent.touchEnd(container, { changedTouches: [{ clientX: toX, clientY: 205 }] });
}

/** Each count tile's text, with spaces between its number, label and line count. */
function tileTexts(container: HTMLElement): string[] {
  return within(container)
    .getAllByTestId("guided-review-count")
    .map((tile) => [...tile.children].map((part) => part.textContent?.trim()).join(" "));
}

describe("formatGuidedReviewAnswers", () => {
  it("puts the message about the whole review first, quoted, so it reads as the user's instruction", () => {
    const text = formatGuidedReviewAnswers(makeGuidedReviewMetaFixture(), {
      answers: {},
      message: "Don't change anything.\nDraft comments.",
    });
    expect(text.split("\n").slice(0, 5)).toEqual([
      "Guided review answers: Retry profile loads and cache profiles",
      "",
      "Message about the whole review:",
      "> Don't change anything.",
      "> Draft comments.",
    ]);
  });

  it("keeps multi-line answers readable and marks unanswered questions", () => {
    const text = formatGuidedReviewAnswers(makeGuidedReviewMetaFixture(), {
      answers: { 1: "One hour.\nAnd clear on edit." },
    });
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
