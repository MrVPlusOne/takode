// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ChatMessage } from "../types.js";

vi.mock("../api.js", () => ({
  api: {
    starMessage: vi.fn(async () => ({})),
    unstarMessage: vi.fn(async () => ({})),
    markNotificationDone: vi.fn(async () => ({})),
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
  },
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div className="markdown-body">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: {} }));

import { MessageBubble } from "./MessageBubble.js";
import { ExpandedCurrentThreadResponse, type AnswerChrome } from "./ThreadResponsePresentationChrome.js";
import { useStore } from "../store.js";

const SESSION_ID = "answer-time-session";

const message: ChatMessage = {
  id: "answer-message",
  role: "assistant",
  content: "Here's where the pilot stands.",
  timestamp: new Date(2026, 10, 4, 13, 54).getTime(),
  historyIndex: 7,
};

function renderAnswer(answer: Omit<AnswerChrome, "message">) {
  render(
    <ExpandedCurrentThreadResponse answer={{ message, ...answer }} sessionId={SESSION_ID}>
      <MessageBubble message={message} sessionId={SESSION_ID} showTimestamp showSideChatActions={false} />
    </ExpandedCurrentThreadResponse>,
  );
}

describe("an answer's time and its reference", () => {
  beforeEach(() => {
    useStore.setState({ sessions: new Map(), replyContexts: new Map(), compactToolActivity: false });
  });

  it.each([
    ["above", { messageCount: 1, answersMessageAbove: true }],
    ["new-result", { messageCount: 0 }],
    ["count", { messageCount: 2 }],
  ] as const)("share one line when the reference is one line (%s)", (variant, answer) => {
    // Jiayi asked for the time and "Answers the message above" on one line, time first, to save
    // the line the time took above the message. The message itself then shows no second time.
    renderAnswer(answer);
    const reference = screen.getByTestId("thread-response-answer-reference");
    expect(reference).toHaveAttribute("data-variant", variant);
    const times = screen.getAllByTestId("message-time-label");
    expect(times).toHaveLength(1);
    expect(reference.firstElementChild).toBe(times[0]);
    expect(times[0]).toHaveAttribute("data-inline", "true");
    expect(times[0]).toHaveAttribute("data-feed-time", String(message.timestamp));
  });

  it("leave the time with the message when the reference quotes the answered messages", () => {
    // A quote can run several lines, so the time keeps its place at the message's start.
    renderAnswer({
      messageCount: 1,
      referencedMessages: [{ historyMessageId: "raw-u1", userMessageId: "u1", content: "Where does the pilot stand?" }],
    });
    const reference = screen.getByTestId("thread-response-answer-reference");
    expect(reference).toHaveAttribute("data-variant", "quote");
    const times = screen.getAllByTestId("message-time-label");
    expect(times).toHaveLength(1);
    expect(reference.contains(times[0])).toBe(false);
    expect(times[0]).not.toHaveAttribute("data-inline");
  });
});
