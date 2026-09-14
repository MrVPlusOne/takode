// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { useStore } from "../store.js";

const annotation = {
  id: "comment",
  selectedText: "The cache expires after one hour.",
  comment: "Could this be configurable?",
  sourceMessageId: "source",
  sourceAnchor: { scopeIndex: 0, start: 0, end: 33, text: "The cache expires after one hour." },
};
let commentHeight = 120;
let textHeight = 80;
const observers = new Map<Element, () => void>();

beforeEach(() => {
  useStore.getState().reset();
  commentHeight = 120;
  textHeight = 80;
  observers.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe(target: Element) {
        observers.set(target, this.callback);
      }
      disconnect() {
        for (const [target, callback] of observers) if (callback === this.callback) observers.delete(target);
      }
    },
  );
  // jsdom has no layout. Count only descendants of the actual measured body, so an
  // attachment outside the parent preview cannot accidentally contribute height.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return (
      this.querySelectorAll("details[open]").length * commentHeight +
      this.querySelectorAll("details:not([open])").length * 30 +
      (this.querySelector(".markdown-body")?.textContent ? textHeight : 0)
    );
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sentMessage(content: string, count = 1) {
  // Use the real persisted-history normalizer, including empty main text and source anchors.
  return normalizeHistoryMessageToChatMessages(
    {
      type: "user_message",
      id: "sent",
      content,
      timestamp: 1,
      annotations: Array.from({ length: count }, (_, index) => ({ ...annotation, id: `comment-${index}` })),
    },
    0,
  )[0];
}

function resizeContent() {
  act(() => observers.get(screen.getByTestId("user-message-content"))?.());
}

it.each(["", "Please explain the tradeoff."])("opens short sent comments with main text %j", (content) => {
  const message = sentMessage(content);
  const original = structuredClone(message);
  const view = render(<MessageBubble message={message} />);
  const details = screen.getByLabelText("Comment 1").closest("details")!;
  expect(details.open).toBe(true);
  expect(screen.getByText(annotation.selectedText).textContent).toBe(annotation.selectedText);
  expect(screen.getByText(annotation.comment).textContent).toBe(annotation.comment);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

  // Native disclosure remains local and survives an authoritative rerender of the same message.
  fireEvent.click(screen.getByLabelText("Comment 1"));
  fireEvent(details, new Event("toggle"));
  expect(details.open).toBe(false);
  view.rerender(<MessageBubble message={{ ...message }} />);
  expect(screen.getByLabelText("Comment 1").closest("details")).toBe(details);
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByLabelText("Comment 1"));
  fireEvent(details, new Event("toggle"));
  expect(details.open).toBe(true);
  expect(message).toEqual(original);
});

it.each([
  ["", 1, 301],
  ["", 3, 110],
  ["A mixed message.", 2, 120],
] as const)("uses one whole-message preview for %j with %i comments", (content, count, height) => {
  commentHeight = height;
  const message = sentMessage(content, count);
  render(<MessageBubble message={message} />);
  const body = screen.getByTestId("user-message-content");
  const preview = body.parentElement!;
  const details = Array.from(body.querySelectorAll("details"));
  expect(details).toHaveLength(count);
  expect(details.every((item) => item.open)).toBe(true);
  expect(preview.style.maxHeight).toBe("300px");
  expect(preview.style.overflow).toBe("hidden");
  const before = body.textContent;

  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(preview.style.maxHeight).toBe("");
  expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  expect(body.textContent).toBe(before);
  expect(Array.from(body.querySelectorAll("details"))).toEqual(details);
  // Full-message expansion must not leave a second vertical scroll cap inside each comment.
  expect(details.every((item) => !item.querySelector(".overflow-auto, .max-h-80"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Show less" }));
  expect(preview.style.maxHeight).toBe("300px");
  expect(body.textContent).toBe(before);
});

it("remeasures comment toggles and width changes without resetting manual message expansion", () => {
  commentHeight = 250;
  render(<MessageBubble message={sentMessage("Mixed text.")} />);
  const details = screen.getByLabelText("Comment 1").closest("details")!;
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  fireEvent.click(screen.getByLabelText("Comment 1"));
  fireEvent(details, new Event("toggle"));
  resizeContent();
  expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  fireEvent.click(screen.getByLabelText("Comment 1"));
  fireEvent(details, new Event("toggle"));
  resizeContent();
  expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Show less" }));
  commentHeight = 100;
  resizeContent();
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  commentHeight = 400;
  resizeContent();
  expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
});

it("keeps the original threshold for plain text and does not expand question-answer receipt comments", () => {
  // Exactly 300px still fits; unrelated system receipts retain their existing disclosure default.
  textHeight = 300;
  const view = render(<MessageBubble message={sentMessage("Plain text.", 0)} />);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  textHeight = 301;
  resizeContent();
  expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  const [receipt] = normalizeHistoryMessageToChatMessages(
    {
      type: "permission_approved",
      id: "receipt",
      tool_name: "AskUserQuestion",
      tool_use_id: "question",
      summary: "Answered",
      timestamp: 2,
      annotationMessage: { content: "", annotations: [annotation] },
    },
    0,
  );
  view.rerender(<MessageBubble message={receipt} />);
  expect(screen.getByLabelText("Comment 1").closest("details")?.open).toBe(false);
});
