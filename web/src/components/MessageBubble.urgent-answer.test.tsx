// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types.js";

vi.mock("../store.js", () => {
  const state = { messages: new Map(), sessions: new Map(), sdkSessions: [], sessionSearch: new Map() };
  const useStore: any = (selector: (value: Record<string, unknown>) => unknown) => selector(state);
  useStore.getState = () => state;
  return {
    useStore,
    getSessionSearchState: () => ({
      query: "",
      isOpen: false,
      mode: "strict",
      category: "all",
      matches: [],
      currentMatchIndex: -1,
    }),
  };
});

import { MessageBubble } from "./MessageBubble.js";

function answer(urgent: boolean, content: ChatMessage["contentBlocks"] | undefined): ChatMessage {
  return {
    id: `answer-${urgent}-${content ? "blocks" : "text"}`,
    role: "assistant",
    content: "Encore replied: they accept the terms.",
    ...(content ? { contentBlocks: content } : {}),
    timestamp: Date.now(),
    metadata: {
      threadAnswer: {
        version: 2,
        answerUserMessageIds: ["u1"],
        observedHistoryLength: 1,
        ...(urgent ? { urgent: true } : {}),
      },
    },
  };
}

describe("MessageBubble urgent answers", () => {
  it("marks an answer its leader flagged urgent, in both assistant render paths", () => {
    // The feed shows the urgent mark above the answer, whether it renders from its
    // text alone or from content blocks.
    const { unmount } = render(<MessageBubble message={answer(true, undefined)} />);
    expect(screen.getByTestId("urgent-answer-label").textContent).toBe("Urgent");
    unmount();
    render(<MessageBubble message={answer(true, [{ type: "text", text: "Encore replied." }])} />);
    expect(screen.getByTestId("urgent-answer-label")).toBeTruthy();
  });

  it("shows no mark on an ordinary answer", () => {
    render(<MessageBubble message={answer(false, [{ type: "text", text: "Encore replied." }])} />);
    expect(screen.queryByTestId("urgent-answer-label")).toBeNull();
  });
});
