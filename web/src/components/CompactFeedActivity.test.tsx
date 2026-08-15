// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ToolMsgGroup } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { CompactFeedActivity } from "./CompactFeedActivity.js";

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
    getToolResult: vi.fn(),
    markNotificationDone: vi.fn(async () => ({})),
    revertToMessage: vi.fn(async () => ({})),
    starMessage: vi.fn(async () => ({})),
    unstarMessage: vi.fn(async () => ({})),
  },
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string; components?: Record<string, unknown> }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("remark-gfm", () => ({ default: {} }));

function largeBashGroup(count: number): ToolMsgGroup {
  return {
    kind: "tool_msg_group",
    toolName: "Bash",
    firstId: "tool-message-1",
    items: Array.from({ length: count }, (_, index) => ({
      id: `tool-${index + 1}`,
      name: "Bash",
      input: { command: `echo ${index + 1}` },
      messageId: "tool-message-1",
    })),
  };
}

const WORKER_MESSAGES: ChatMessage[] = [
  {
    id: "worker-message-1",
    role: "user",
    content: "1 event from 1 session\n\n#2485 | turn_end | ok 12s | tools: 7\n  completed the command run",
    timestamp: 1_786_340_000_000,
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2485",
        sessionNum: 2485,
        routine: true,
        ts: 1_786_340_000_000,
      },
    ],
  },
  {
    id: "worker-message-2",
    role: "user",
    content: "1 event from 1 session\n\n#2486 | session_error | interrupted | tools: 3\n  preserved recovery detail",
    timestamp: 1_786_340_001_000,
    takodeHerdEvents: [
      { event: "session_error", sessionId: "worker-2486", sessionNum: 2486, routine: false, ts: 1_786_340_001_000 },
    ],
  },
];

beforeEach(() => {
  useStore.getState().reset();
});

afterEach(() => {
  useStore.getState().reset();
});

describe("CompactFeedActivity", () => {
  it("keeps producer-shaped worker-event counts beside a large tool-call fallback", () => {
    // q-1799 worker events remain a distinct category while long tool summaries collapse to a count.
    render(
      <CompactFeedActivity
        segments={[
          { kind: "tool", groups: [largeBashGroup(7)] },
          { kind: "worker_event", messages: WORKER_MESSAGES },
        ]}
        sessionId="compact-feed-session"
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />,
    );

    const summary = screen.getByRole("button", {
      name: "Show 9 activity items: 7 tool calls, 2 worker events",
    });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("echo 1")).toBeNull();
    expect(screen.queryByText(/preserved recovery detail/)).toBeNull();

    fireEvent.click(summary);
    expect(screen.getByText("echo 1")).toBeTruthy();
    expect(screen.getByText("echo 7")).toBeTruthy();
    expect(screen.getByText(/preserved recovery detail/)).toBeTruthy();
  });

  it("keeps sent messages, commands, and worker events as truthful mixed categories", () => {
    render(
      <CompactFeedActivity
        segments={[
          {
            kind: "tool",
            groups: [
              {
                kind: "tool_msg_group",
                toolName: "Bash",
                firstId: "mixed-message",
                items: [
                  {
                    id: "send-1",
                    name: "Bash",
                    input: { command: 'takode send 17 "Please continue"' },
                    messageId: "mixed-message",
                  },
                  { id: "bash-1", name: "Bash", input: { command: "git status" }, messageId: "mixed-message" },
                ],
              },
            ],
          },
          { kind: "worker_event", messages: [WORKER_MESSAGES[0]] },
        ]}
        sessionId="compact-feed-session"
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />,
    );

    expect(screen.getByText("Sent a message, ran command, 1 worker event")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show 3 activity items/ }));
    expect(screen.getByText(/takode send 17/)).toBeTruthy();
    expect(screen.getByText("git status")).toBeTruthy();
    expect(screen.getByText(/completed the command run/)).toBeTruthy();
  });

  it("keeps a failed pure send labeled by intent while preserving the expanded error", () => {
    useStore.setState({
      toolResults: new Map([
        [
          "compact-feed-session",
          new Map([
            [
              "send-failed",
              {
                tool_use_id: "send-failed",
                content: "Cannot send to archived session #17.",
                is_error: true,
                total_size: 36,
                is_truncated: false,
              },
            ],
          ]),
        ],
      ]),
    });

    render(
      <CompactFeedActivity
        segments={[
          {
            kind: "tool",
            groups: [
              {
                kind: "tool_msg_group",
                toolName: "Bash",
                firstId: "failed-message",
                items: [
                  {
                    id: "send-failed",
                    name: "Bash",
                    input: { command: 'takode send 17 "Please continue"' },
                    messageId: "failed-message",
                  },
                ],
              },
            ],
          },
        ]}
        sessionId="compact-feed-session"
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />,
    );

    expect(screen.getByText("Sent a message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 tool call/ }));
    const command = screen.getByText(/takode send 17/);
    expect(command).toBeTruthy();
    fireEvent.click(command.closest('[role="button"]')!);
    expect(screen.getByText("Cannot send to archived session #17.")).toBeTruthy();
  });
});
