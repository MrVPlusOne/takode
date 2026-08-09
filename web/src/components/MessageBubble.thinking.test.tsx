// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types.js";

vi.mock("react-markdown", () => ({
  default: ({
    children,
    components,
  }: {
    children: string;
    components?: { p?: (props: { children: string }) => ReactNode };
  }) => {
    if (components?.p) return <div data-testid="markdown">{components.p({ children })}</div>;
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({ default: {} }));

import { MessageBubble } from "./MessageBubble.js";
import { useStore } from "../store.js";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: `thinking-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function setCodexSession(): void {
  const sessions = new Map(useStore.getState().sessions);
  sessions.set("codex-session", { backend_type: "codex" } as any);
  useStore.setState({ sessions });
}

beforeEach(() => {
  useStore.setState({ sessions: new Map(), compactToolActivity: false });
});

describe("MessageBubble thinking blocks", () => {
  it("renders Claude thinking as a collapsible block", () => {
    // Non-Codex thinking remains a durable, user-expandable message.
    const thinkingText = "Let me analyze this problem step by step...";
    render(<MessageBubble message={makeMessage({ contentBlocks: [{ type: "thinking", thinking: thinkingText }] })} />);

    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText(`${thinkingText.length} chars`)).toBeTruthy();
  });

  it("expands and collapses Claude thinking", () => {
    // The generic thinking disclosure must preserve its existing interaction.
    const thinkingText = "Deep analysis of the problem at hand.";
    render(<MessageBubble message={makeMessage({ contentBlocks: [{ type: "thinking", thinking: thinkingText }] })} />);

    const thinkingButton = screen.getByText("Thinking").closest("button")!;
    fireEvent.click(thinkingButton);
    expect(screen.getByText(thinkingText)).toBeTruthy();
    fireEvent.click(thinkingButton);
    expect(screen.queryByText(thinkingText)).toBeNull();
  });

  it("renders short parented Codex thinking inline", () => {
    // Parented thinking belongs to a scoped subagent and must not use root suppression.
    setCodexSession();
    const thinkingText = "Short codex reasoning summary.";
    render(
      <MessageBubble
        message={makeMessage({
          contentBlocks: [{ type: "thinking", thinking: thinkingText }],
          parentToolUseId: "agent-1",
        })}
        sessionId="codex-session"
      />,
    );

    expect(screen.getByText(thinkingText)).toBeTruthy();
    expect(screen.queryByText(`${thinkingText.length} chars`)).toBeNull();
    expect(screen.queryByRole("button", { name: /expand thinking summary/i })).toBeNull();
  });

  it("suppresses root Codex thinking-only messages even when legacy content mirrors the block", () => {
    // Legacy hydrated messages may retain reasoning in both `content` and `contentBlocks`; neither may leave a shell.
    setCodexSession();
    const reasoning = "**Historical reasoning row**\n\nBody should not persist.";
    const { container } = render(
      <MessageBubble
        message={makeMessage({ content: reasoning, contentBlocks: [{ type: "thinking", thinking: reasoning }] })}
        sessionId="codex-session"
      />,
    );

    expect(container.textContent).toBe("");
    expect(screen.queryByText(/Historical reasoning row/)).toBeNull();
  });

  it("suppresses root Codex thinking while preserving a sibling tool", () => {
    // A mixed legacy message must retain useful non-thinking activity without exposing durable reasoning.
    setCodexSession();
    render(
      <MessageBubble
        message={makeMessage({
          content: "**Evaluating quest ideas**\n\nI need to inspect the current task.",
          contentBlocks: [
            { type: "thinking", thinking: "**Evaluating quest ideas**\n\nI need to inspect the current task." },
            { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "quest list" } },
          ],
        })}
        sessionId="codex-session"
      />,
    );

    expect(screen.queryByText(/Evaluating quest ideas/)).toBeNull();
    expect(screen.getByText("quest list")).toBeTruthy();
  });

  it("suppresses root Codex thinking while preserving sibling text", () => {
    // Visible assistant text must survive even when the same message carries hidden root reasoning.
    setCodexSession();
    render(
      <MessageBubble
        message={makeMessage({
          content: "**Hidden reasoning**\n\nVisible answer",
          contentBlocks: [
            { type: "thinking", thinking: "**Hidden reasoning**\n\nThis should not persist." },
            { type: "text", text: "Visible answer" },
          ],
        })}
        sessionId="codex-session"
      />,
    );

    expect(screen.queryByText(/Hidden reasoning/)).toBeNull();
    expect(screen.getByText("Visible answer")).toBeTruthy();
  });

  it("keeps long parented Codex thinking expandable", () => {
    // Scoped subagent summaries retain the compact legacy disclosure behavior.
    setCodexSession();
    const thinkingText =
      "This is a much longer codex reasoning summary that should be truncated in preview mode until the user expands it via the ellipsis control at the end.";
    render(
      <MessageBubble
        message={makeMessage({
          contentBlocks: [{ type: "thinking", thinking: thinkingText }],
          parentToolUseId: "agent-1",
        })}
        sessionId="codex-session"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /expand thinking summary/i }));
    expect(screen.getByText(thinkingText)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /collapse thinking summary/i }));
    expect(screen.queryByText(thinkingText)).toBeNull();
  });

  it("shows parented Codex thinking duration inline", () => {
    // Timing remains attached to scoped subagent reasoning after root-only suppression.
    setCodexSession();
    render(
      <MessageBubble
        message={makeMessage({
          contentBlocks: [{ type: "thinking", thinking: "Summary text", thinking_time_ms: 1200 }],
          parentToolUseId: "agent-1",
        })}
        sessionId="codex-session"
      />,
    );
    expect(screen.getByText("Summary text (1.2 s)")).toBeTruthy();
  });

  it("strips outer bold markers from parented Codex thinking", () => {
    // The scoped compact renderer should not expose provider Markdown delimiters.
    setCodexSession();
    render(
      <MessageBubble
        message={makeMessage({
          contentBlocks: [{ type: "thinking", thinking: "**Checking route fields for reasoning effort**" }],
          parentToolUseId: "agent-1",
        })}
        sessionId="codex-session"
      />,
    );
    expect(screen.getByText("Checking route fields for reasoning effort")).toBeTruthy();
  });

  it("does not duplicate parented Codex thinking through the content fallback", () => {
    // A legacy mirrored content string must not render a second Markdown copy.
    setCodexSession();
    const thinkingText = "Inspecting session and worktree";
    render(
      <MessageBubble
        message={makeMessage({
          content: thinkingText,
          contentBlocks: [{ type: "thinking", thinking: thinkingText }],
          parentToolUseId: "agent-1",
        })}
        sessionId="codex-session"
      />,
    );

    expect(screen.getAllByText(thinkingText)).toHaveLength(1);
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  it("uses explicit backend identity for disconnected Codex previews", () => {
    // Hover cards can render messages for sessions absent from the connected-session store.
    const reasoning = "Disconnected root reasoning";
    const { container } = render(
      <MessageBubble
        message={makeMessage({ content: reasoning, contentBlocks: [{ type: "thinking", thinking: reasoning }] })}
        backendType="codex"
      />,
    );

    expect(container.textContent).toBe("");
  });
});
