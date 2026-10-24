// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ sendToSession: vi.fn(() => true) }));
vi.mock("../ws.js", () => ({ sendToSession: ws.sendToSession }));
// Drafts go to the draft sync; here only what this tab holds matters.
vi.mock("../draft-sync.js", () => ({ flushPendingDrafts: vi.fn() }));

import { MarkdownReport } from "./MarkdownReport.js";
import { GuidedReviewViewerHost } from "./GuidedReviewViewer.js";
import { codeLinesInRange } from "./GuidedReviewLineComments.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { formatGuidedReviewAnswers, useGuidedReviewState } from "../guided-review-state.js";
import {
  makeGuidedReviewMetaFixture,
  makeGuidedReviewReportFixture,
} from "../../shared/test-fixtures/guided-review.js";

async function openStop(stopsForward: number) {
  render(
    <>
      <MarkdownReport message={normalizeHistoryMessageToChatMessages(makeGuidedReviewReportFixture(), 7)[0]} />
      <GuidedReviewViewerHost />
    </>,
  );
  fireEvent.click(within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Start the review" }));
  const viewer = await screen.findByTestId("guided-review-viewer");
  for (let n = 0; n < stopsForward; n++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
  return viewer;
}

/** The current stop's code lines. */
function codeRows(viewer: HTMLElement): HTMLElement[] {
  return [...within(viewer).getByTestId("guided-review-stop").querySelectorAll<HTMLElement>(".diff-line")];
}

/** Select from the start of one code line's text to the end of another's, as dragging over them does. */
function selectRows(first: HTMLElement, last: HTMLElement) {
  const range = document.createRange();
  range.setStart(first.querySelector(".diff-content")!, 0);
  const end = last.querySelector(".diff-content")!;
  range.setEnd(end, end.childNodes.length);
  installSelection(range);
  return range;
}

function installSelection(range: Range) {
  Object.defineProperty(range, "getBoundingClientRect", { value: () => new DOMRect(40, 120, 300, 60) });
  vi.spyOn(window, "getSelection").mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: range.startContainer,
    focusNode: range.endContainer,
    toString: () => range.toString(),
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  } as unknown as Selection);
  fireEvent.mouseDown(screen.getByTestId("guided-review-walkthrough"));
  act(() => {
    fireEvent.mouseUp(document);
  });
}

describe("comments on lines of a guided review's code", () => {
  beforeEach(() => {
    useGuidedReviewState.setState({ open: null, drafts: {}, reviewSessions: {}, lineCommentEditor: null });
    ws.sendToSession.mockClear();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("comments on the selected lines, marks them, lists the comment on the stop and sends it with the answers", async () => {
    // Stop 2 shows src/client.ts lines 5-7: a removed line, then three added ones.
    const viewer = await openStop(2);
    const stop = within(viewer).getByTestId("guided-review-stop");
    expect(stop).toHaveTextContent("Select lines in the code to comment on them.");
    const rows = codeRows(viewer);
    expect(rows.map((row) => row.className.match(/diff-line-(add|del|context)/)?.[1])).toEqual([
      "del",
      "add",
      "add",
      "add",
    ]);

    // A selection from the removed line into the first added one covers both whole lines.
    selectRows(rows[0], rows[1]);
    fireEvent.click(screen.getByRole("button", { name: "Comment on line 5 with removed line 4" }));
    const editor = screen.getByRole("dialog", { name: "Edit annotation" });
    // The editor names the file and lines and quotes the code as shown, markers and all.
    expect(editor).toHaveTextContent("src/client.ts · line 5 with removed line 4");
    expect(editor.querySelector("blockquote")?.textContent).toBe(
      "-  const profile = await fetchJson(`/profiles/${id}`);\n+  const profile = await withRetry(() => fetchJson(`/profiles/${id}`));",
    );
    fireEvent.change(within(editor).getByRole("textbox", { name: "Comment" }), {
      target: { value: "Retry only on network errors here." },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog", { name: "Edit annotation" })).toBeNull();

    // The commented lines are marked; the others are not.
    expect(codeRows(viewer).map((row) => row.classList.contains("diff-line-marked"))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const list = within(viewer).getByTestId("guided-review-stop-comments");
    expect(list).toHaveTextContent("client.ts · line 5 with removed line 4");
    expect(list).toHaveTextContent("Retry only on network errors here.");
    expect(within(viewer).getByText("0 of 2 answered · 1 comment")).toBeInTheDocument();

    // A comment opens in the editor again to change it.
    fireEvent.click(within(list).getByRole("button", { name: /Retry only on network errors/ }));
    const again = screen.getByRole("dialog", { name: "Edit annotation" });
    fireEvent.change(within(again).getByRole("textbox", { name: "Comment" }), {
      target: { value: "Retry only on network errors, and never a 404." },
    });
    fireEvent.click(within(again).getByRole("button", { name: "Save" }));

    // The wrap-up lists every comment beside the answers, and Send carries them to the agent.
    fireEvent.click(within(viewer).getByRole("button", { name: "Next" }));
    fireEvent.click(within(viewer).getByRole("button", { name: "Wrap up" }));
    const all = within(viewer).getByTestId("guided-review-line-comments");
    expect(all).toHaveTextContent("Your comments on the code");
    expect(all).toHaveTextContent("Profiles cached for a day");
    expect(all).toHaveTextContent("Retry only on network errors, and never a 404.");
    fireEvent.click(within(viewer).getByRole("button", { name: "Send answers" }));
    const content = (ws.sendToSession.mock.calls[0] as unknown as [string, { content: string }])[1].content;
    expect(content.split("\n").slice(-8)).toEqual([
      "Comments on the code (lines numbered as in the file after the change, removed lines as before it):",
      "",
      'src/client.ts, line 5 with removed line 4 (stop "Profiles cached for a day"):',
      "```diff",
      "-  const profile = await fetchJson(`/profiles/${id}`);",
      "+  const profile = await withRetry(() => fetchJson(`/profiles/${id}`));",
      "```",
      "Comment: Retry only on network errors, and never a 404.",
    ]);
  });

  it("deletes a comment, and shows comments read-only once the review is sent", async () => {
    const viewer = await openStop(2);
    const rows = codeRows(viewer);
    selectRows(rows[2], rows[3]);
    fireEvent.click(screen.getByRole("button", { name: "Comment on lines 6-7" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "Name the constant." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(within(viewer).getByRole("button", { name: /Name the constant/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    expect(within(viewer).queryByTestId("guided-review-stop-comments")).toBeNull();
    expect(codeRows(viewer).some((row) => row.classList.contains("diff-line-marked"))).toBe(false);
    // Nothing left to send: no answers and no comments.
    expect(useGuidedReviewState.getState().drafts["review-fixture"]).toBeUndefined();

    selectRows(rows[3], rows[3]);
    fireEvent.click(screen.getByRole("button", { name: "Comment on line 7" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "Keep this one." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.click(within(viewer).getByRole("button", { name: "Send answers" }));

    fireEvent.click(within(screen.getByTestId("guided-review-card")).getByRole("button", { name: "Open review" }));
    const reopened = await screen.findByTestId("guided-review-viewer");
    expect(within(reopened).getByTestId("guided-review-line-comments")).toHaveTextContent("Keep this one.");
    // Sent comments can't be opened for editing, and the code no longer offers new ones.
    expect(within(reopened).queryByRole("button", { name: /Keep this one/ })).toBeNull();
    fireEvent.click(within(reopened).getByRole("button", { name: /^Cache profiles for a day\?/ }));
    expect(codeRows(reopened)[3]).toHaveClass("diff-line-marked");
    selectRows(codeRows(reopened)[0], codeRows(reopened)[0]);
    expect(screen.queryByRole("button", { name: /Comment on/ })).toBeNull();
  });
});

describe("codeLinesInRange", () => {
  function codeContainer() {
    const container = document.createElement("div");
    container.innerHTML = `
      <div data-review-code data-review-stop="2" data-review-path="src/a.ts">
        <div class="diff-line diff-line-context" data-old-line="3" data-new-line="3"><span class="diff-content">keep()</span></div>
        <div class="diff-line diff-line-del" data-old-line="4"><span class="diff-content">gone()</span></div>
        <div class="diff-line diff-line-del" data-old-line="5"><span class="diff-content">&nbsp;</span></div>
        <div class="diff-line diff-line-add" data-new-line="4"><span class="diff-content">added()</span></div>
      </div>
      <div data-review-code data-review-stop="3" data-review-path="src/b.ts">
        <div class="diff-line diff-line-add" data-new-line="9"><span class="diff-content">other()</span></div>
      </div>`;
    document.body.append(container);
    const rows = [...container.querySelectorAll<HTMLElement>(".diff-content")];
    return { container, rows };
  }

  it("covers whole lines and numbers removed lines as before the change", () => {
    const { container, rows } = codeContainer();
    const range = document.createRange();
    // From the middle of one removed line to the middle of the other.
    range.setStart(rows[1].firstChild!, 2);
    range.setEnd(rows[2].firstChild!, 1);
    expect(codeLinesInRange(range, container)).toEqual({
      stop: 2,
      path: "src/a.ts",
      removedLines: [4, 5],
      code: "-gone()\n-",
    });
    container.remove();
  });

  it("leaves out the next line when the selection ends at its very start, as a triple click does", () => {
    const { container, rows } = codeContainer();
    const range = document.createRange();
    range.setStart(rows[0].firstChild!, 0);
    range.setEnd(rows[1].firstChild!, 0);
    expect(codeLinesInRange(range, container)).toEqual({
      stop: 2,
      path: "src/a.ts",
      lines: [3, 3],
      code: " keep()",
    });
    container.remove();
  });

  it("refuses a selection that spans two pieces of code", () => {
    const { container, rows } = codeContainer();
    const range = document.createRange();
    range.setStart(rows[3].firstChild!, 0);
    range.setEnd(rows[4].firstChild!, 3);
    expect(codeLinesInRange(range, container)).toBeNull();
    container.remove();
  });
});

describe("formatGuidedReviewAnswers with line comments", () => {
  it("fences code longer than any backticks in it and names removed lines by their old numbers", () => {
    const text = formatGuidedReviewAnswers(makeGuidedReviewMetaFixture(), {
      answers: {},
      lineComments: [
        {
          id: "c1",
          stop: 99,
          path: "docs/a.md",
          removedLines: [3, 4],
          code: "-```ts\n-old()",
          comment: "Why remove the example?\nIt was useful.",
        },
      ],
    });
    expect(text.split("\n").slice(-9)).toEqual([
      "Comments on the code (lines numbered as in the file after the change, removed lines as before it):",
      "",
      "docs/a.md, removed lines 3-4:",
      "````diff",
      "-```ts",
      "-old()",
      "````",
      "Comment: Why remove the example?",
      "It was useful.",
    ]);
  });
});
