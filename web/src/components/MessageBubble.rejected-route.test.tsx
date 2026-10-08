// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BrowserIncomingMessage, ContentBlock } from "../../server/session-types.js";
import { normalizeLeaderAssistantRouting } from "../../server/bridge/thread-routing-reminder.js";
import { finalizeRoutedLeaderResponseMessage } from "../../server/leader-thread-response.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";

vi.mock("../api.js", () => ({ api: {} }));

import { MessageBubble } from "./MessageBubble.js";

type AssistantHistoryMessage = Extract<BrowserIncomingMessage, { type: "assistant" }>;

/**
 * Build a leader assistant row the way the server does: routing is decided by
 * the server's leader routing normalizer, and the browser receives the row
 * through the history normalizer. This keeps the fixture producer-shaped.
 */
function routedLeaderRow(id: string, content: ContentBlock[]): AssistantHistoryMessage {
  const {
    content: routedContent,
    questThreadReminders,
    threadStatusMarkers,
    ...route
  } = normalizeLeaderAssistantRouting(true, content, null);
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: routedContent,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1_791_427_000_000,
    ...route,
  } as AssistantHistoryMessage;
}

function toChatMessage(row: AssistantHistoryMessage): ChatMessage {
  const [message] = normalizeHistoryMessageToChatMessages(row, 0);
  return message!;
}

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

beforeEach(() => {
  useStore.getState().reset();
});

describe("leader messages rejected for bad thread tags", () => {
  it("collapses the real link-shaped marker example and expands it on click", async () => {
    // Leader #2771 sent this on 2026-10-07: the first line is a Markdown link
    // shaped like a marker, so the server rejected the route as invalid and the
    // raw text, including literal tag syntax, used to render in Main.
    const rawText = [
      "[thread:q-2304](quest:q-2304)",
      "[thread:q-2304:C]",
      "[q-2304](quest:q-2304) is complete. One check is left for you.",
    ].join("\n");
    const message = toChatMessage(routedLeaderRow("rejected-invalid", [text(rawText)]));
    expect(message.metadata?.threadRoutingError).toMatchObject({ reason: "invalid", source: "visible_text" });

    render(<MessageBubble message={message} sessionId="leader-session" />);

    const header = screen.getByTestId("rejected-route-message-header");
    expect(header.textContent).toContain("Unrouted message");
    // No resend is claimed: the row cannot know whether the leader resent it.
    expect(header.textContent).not.toContain("resent");
    expect(header.textContent).toContain("invalid thread tag");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/One check is left for you/)).toBeNull();

    await userEvent.click(header);

    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/One check is left for you/)).toBeTruthy();
  });

  it("collapses visible leader text that has no thread marker", () => {
    // A trailing sentence after a tool call with no marker is a common rejection.
    const message = toChatMessage(
      routedLeaderRow("rejected-missing", [text("I'm waiting to hear whether the alert disappeared.")]),
    );

    render(<MessageBubble message={message} sessionId="leader-session" />);

    expect(screen.getByTestId("rejected-route-message-header").textContent).toContain("missing thread tag");
    expect(screen.queryByText(/waiting to hear/)).toBeNull();
  });

  it("leaves correctly routed leader text unchanged", () => {
    const message = toChatMessage(
      routedLeaderRow("routed", [text("[thread:q-2304:C]\nThe status-chip fix is complete.")]),
    );
    expect(message.metadata?.threadRoutingError).toBeUndefined();

    render(<MessageBubble message={message} sessionId="leader-session" />);

    expect(screen.queryByTestId("rejected-route-message-header")).toBeNull();
    expect(screen.getByText(/status-chip fix is complete/)).toBeTruthy();
  });

  it("collapses only the prose of a rejected answer and keeps its tool call visible", () => {
    // Rejected answers seen in #2771 carried a `takode notify` Bash call in the
    // same message. The server rejects the answer at turn settlement; the call
    // itself still ran, so it must stay visible while the prose collapses.
    const row = routedLeaderRow("rejected-answer", [
      text("[thread:main:A:u1]\nYour fix is the right one: the composer buttons never move."),
      {
        type: "tool_use",
        id: "tool-notify",
        name: "Bash",
        input: { command: "# thread:main\ntakode notify needs-input 'Composer layout'" },
      },
    ]);
    const finalized = finalizeRoutedLeaderResponseMessage({ id: "leader-session", messageHistory: [row] }, row);
    expect(finalized.finalized).toBe(false);
    const message = toChatMessage(row);
    expect(message.metadata?.threadRoutingError).toMatchObject({
      reason: "invalid_answer_route",
      source: "answer_marker",
    });

    render(<MessageBubble message={message} sessionId="leader-session" />);

    expect(screen.getByTestId("rejected-route-message-header").textContent).toContain("Rejected answer");
    expect(screen.queryByText(/composer buttons never move/)).toBeNull();
    expect(screen.getAllByText(/takode notify needs-input/).length).toBeGreaterThan(0);
  });

  it("does not collapse an unmarked shell command, which has no rejected text", () => {
    const message = toChatMessage(
      routedLeaderRow("unmarked-command", [
        { type: "tool_use", id: "tool-ls", name: "Bash", input: { command: "quest show q-2304" } },
      ]),
    );
    expect(message.metadata?.threadRoutingError).toMatchObject({ source: "shell_command" });

    render(<MessageBubble message={message} sessionId="leader-session" />);

    expect(screen.queryByTestId("rejected-route-message-header")).toBeNull();
  });

  it("shows the rejected text when it is the current search match", () => {
    const message = toChatMessage(routedLeaderRow("rejected-search", [text("The iPhone Web Push build is ready.")]));
    useStore.getState().setSessionSearchQuery("leader-session", "Web Push");
    useStore.getState().setSessionSearchResults("leader-session", [{ messageId: "rejected-search" }]);

    render(<MessageBubble message={message} sessionId="leader-session" />);

    expect(screen.getByTestId("rejected-route-message-header").getAttribute("aria-expanded")).toBe("true");
  });
});
