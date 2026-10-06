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

const LIFECYCLE_MESSAGES: ChatMessage[] = [
  {
    id: "worker-waiting",
    role: "user",
    content: "1 event from 1 session\n\n#2485 | turn_end | ✓ turn complete 12s | waiting for decision; Work preserved",
    timestamp: 1_786_340_002_000,
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2485",
        sessionNum: 2485,
        routine: false,
        ts: 1_786_340_002_000,
        lifecycle: ["waiting_for_decision"],
      },
    ],
  },
  {
    id: "worker-resumed",
    role: "user",
    content: "1 event from 1 session\n\n#2485 | turn_end | ✓ turn complete 15s | same Work resumed after decision wait",
    timestamp: 1_786_340_003_000,
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2485",
        sessionNum: 2485,
        routine: false,
        ts: 1_786_340_003_000,
        lifecycle: ["resumed_after_decision"],
      },
    ],
  },
  {
    id: "worker-compacted",
    role: "user",
    content:
      "1 event from 1 session\n\n#2485 | turn_end | ✓ turn complete 30s | context compacted; same Work continued",
    timestamp: 1_786_340_004_000,
    takodeHerdEvents: [
      {
        event: "turn_end",
        sessionId: "worker-2485",
        sessionNum: 2485,
        routine: false,
        ts: 1_786_340_004_000,
        lifecycle: ["context_continued"],
      },
    ],
  },
];

beforeEach(() => {
  useStore.getState().reset();
});

afterEach(() => {
  useStore.getState().reset();
});

function lineTexts(): string[] {
  return screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent ?? "");
}

describe("CompactFeedActivity", () => {
  it("previews worker events by their header summary and keeps event bodies behind each line", () => {
    // Each herd message is one line naming the session, event and lifecycle state;
    // the full event body only renders when that line is opened.
    render(
      <CompactFeedActivity
        segments={[{ kind: "worker_event", messages: LIFECYCLE_MESSAGES }]}
        sessionId="compact-feed-session"
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />,
    );

    const summary = screen.getByText("3 worker events");
    expect(summary.className).toContain("truncate");
    expect(lineTexts()).toEqual([
      "Event#2485 | turn_end | waiting for decision; Work preserved",
      "Event#2485 | turn_end | same Work resumed after decision wait",
      "Event#2485 | turn_end | context compacted; same Work continued",
    ]);
    expect(screen.queryByText(/turn complete 12s/)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Event: #2485 | turn_end | waiting for decision; Work preserved" }),
    );
    expect(screen.getByText(/turn complete 12s/)).toBeTruthy();
  });

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
      name: "Show all 9 activity items: 7 tool calls, 2 worker events",
    });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    // The rolling window shows the newest three activities and folds the rest.
    expect(screen.getByTestId("compact-tool-activity-earlier").textContent).toBe("+6 earlier");
    expect(lineTexts()[0]).toBe("Bashecho 7");
    expect(screen.queryByText(/preserved recovery detail/)).toBeNull();

    fireEvent.click(summary);
    expect(lineTexts()).toHaveLength(9);
    expect(lineTexts()[0]).toBe("Bashecho 1");
    fireEvent.click(screen.getByRole("button", { name: /^Show Event: #2486 \| session_error/ }));
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
    // The send line never previews the message body.
    expect(lineTexts()[0]).toBe("SendSent a message");
    expect(screen.queryByText(/takode send 17/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Send: Sent a message" }));
    expect(screen.getByText(/takode send 17/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Show Event: #2485/ }));
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

    expect(lineTexts()).toEqual(["SendSent a messagefailed"]);
    fireEvent.click(screen.getByRole("button", { name: "Show Send: Sent a message" }));
    expect(screen.getByText(/takode send 17/)).toBeTruthy();
    expect(screen.getByText("Cannot send to archived session #17.")).toBeTruthy();
  });

  it("folds thinking into the group as thought lines with the full text behind each line", () => {
    // Only agent text splits activity groups, so thinking-only messages join the group.
    const thought: ChatMessage = {
      id: "thought-1",
      role: "assistant",
      content: "",
      timestamp: 1_786_340_005_000,
      contentBlocks: [{ type: "thinking", thinking: "**Check the flush path**\nThe replay gate starts it." }],
    };
    render(
      <CompactFeedActivity
        segments={[
          { kind: "thought", messages: [thought] },
          { kind: "tool", groups: [largeBashGroup(2)] },
        ]}
        sessionId="compact-feed-session"
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />,
    );

    expect(screen.getByText("Thought, ran 2 commands")).toBeTruthy();
    expect(lineTexts()).toEqual(["ThoughtCheck the flush path", "Bashecho 1", "Bashecho 2"]);
    expect(screen.queryByText(/The replay gate starts it/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Thought: Check the flush path" }));
    expect(screen.getByText(/The replay gate starts it/)).toBeTruthy();
  });
});
