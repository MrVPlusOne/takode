// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage, ContentBlock } from "../types.js";

// Mock react-markdown to avoid ESM/parsing issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { MessageBubble } from "./MessageBubble.js";
import { useStore } from "../store.js";

beforeEach(() => {
  useStore.setState({ compactToolActivity: false });
});

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── groupContentBlocks behavior (tested indirectly through MessageBubble) ──

describe("MessageBubble - content block grouping", () => {
  it("collapses consecutive mixed tool blocks while leaving assistant text visible", () => {
    // Compact mode should affect only the tool run between prose blocks, never the model's own explanation.
    useStore.setState({ compactToolActivity: true });
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [
        { type: "text", text: "I will inspect the implementation." },
        { type: "tool_use", id: "tu-read", name: "Read", input: { file_path: "/a.ts" } },
        { type: "tool_use", id: "tu-bash", name: "Bash", input: { command: "bun test" } },
        { type: "tool_use", id: "tu-grep", name: "Grep", input: { pattern: "compact", path: "src" } },
        { type: "text", text: "The focused tests pass." },
      ],
    });
    render(<MessageBubble message={msg} />);

    expect(screen.getByText("I will inspect the implementation.")).toBeTruthy();
    expect(screen.getByText("The focused tests pass.")).toBeTruthy();
    expect(screen.getByText("Read file, ran command, searched for compact")).toBeTruthy();
    // Text follows the run inside the message, so the group is no longer active:
    // collapsed it shows only its heading, with no "+N earlier" row.
    expect(screen.queryAllByTestId("compact-tool-activity-line")).toHaveLength(0);
    expect(screen.queryByTestId("compact-tool-activity-earlier")).toBeNull();

    // Expanding lists each tool as a short line; its chip details render only
    // when that line is opened.
    fireEvent.click(screen.getByRole("button", { name: /Show all 3 tool calls/ }));
    expect(screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent)).toEqual([
      "Reada.ts",
      "Bashbun test",
      "Grepcompact in src",
    ]);
    expect(screen.getAllByText("bun test")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Show Bash: bun test" }));
    expect(screen.getAllByText("bun test")).toHaveLength(2);
  });

  it("counts producer-shaped large Bash and MCP runs without counting result state", () => {
    // Results are keyed support data for the seven tool_use blocks, not additional activity items.
    useStore.setState({
      compactToolActivity: true,
      toolResults: new Map([
        [
          "large-tool-session",
          new Map([
            [
              "tu-bash-1",
              {
                tool_use_id: "tu-bash-1",
                content: "command complete",
                is_error: false,
                total_size: 16,
                is_truncated: false,
              },
            ],
            [
              "tu-mcp-1",
              {
                tool_use_id: "tu-mcp-1",
                content: "search complete",
                is_error: false,
                total_size: 15,
                is_truncated: false,
              },
            ],
          ]),
        ],
      ]),
    });
    const contentBlocks: ContentBlock[] = [
      ...Array.from(
        { length: 4 },
        (_, index): ContentBlock => ({
          type: "tool_use",
          id: `tu-bash-${index + 1}`,
          name: "Bash",
          input: { command: `echo ${index + 1}` },
        }),
      ),
      ...Array.from(
        { length: 3 },
        (_, index): ContentBlock => ({
          type: "tool_use",
          id: `tu-mcp-${index + 1}`,
          name: `mcp:slack:${index % 2 === 0 ? "search_messages" : "get_thread"}`,
          input: { query: `evidence ${index + 1}` },
        }),
      ),
    ];
    const msg = makeMessage({ role: "assistant", content: "", contentBlocks });
    render(<MessageBubble message={msg} sessionId="large-tool-session" />);

    expect(screen.getByText("7 tool calls")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 7 tool calls: 7 tool calls" })).toBeTruthy();
    // The collapsed run shows its newest three calls and folds the rest.
    expect(screen.getByTestId("compact-tool-activity-earlier").textContent).toBe("+4 earlier");
    expect(screen.queryByText("echo 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all 7 tool calls: 7 tool calls" }));
    expect(screen.getByText("echo 1")).toBeTruthy();
    expect(screen.getAllByText("slack:search_messages").length).toBeGreaterThan(0);
  });

  it("keeps interactive tools visible in compact mode", () => {
    // User-input tools are intentionally excluded from passive activity summaries.
    useStore.setState({ compactToolActivity: true });
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [{ type: "tool_use", id: "tu-ask", name: "AskUserQuestion", input: { question: "Continue?" } }],
    });
    render(<MessageBubble message={msg} />);

    expect(screen.queryByTestId("compact-tool-activity")).toBeNull();
    expect(screen.getAllByText("Question").length).toBeGreaterThan(0);
  });

  it("renders file-tool blocks as standalone chips without grouping", () => {
    // Edit/Write/Read tools are never grouped -- each gets its own standalone chip
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [
        { type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "/a.ts" } },
        { type: "tool_use", id: "tu-2", name: "Read", input: { file_path: "/b.ts" } },
        { type: "tool_use", id: "tu-3", name: "Read", input: { file_path: "/c.ts" } },
      ],
    });
    render(<MessageBubble message={msg} />);

    // No count badge -- each is standalone
    expect(screen.queryByText("3")).toBeNull();
    // 3 standalone chips, each with "Read File" label
    const labels = screen.getAllByText("Read File");
    expect(labels.length).toBe(3);
  });

  it("keeps the outer Terminal group label while removing repeated inner bash labels", () => {
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [
        { type: "tool_use", id: "tu-1", name: "Bash", input: { command: "test -f package.json" } },
        { type: "tool_use", id: "tu-2", name: "Bash", input: { command: "bun run test" } },
      ],
    });

    render(<MessageBubble message={msg} />);

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("Terminal")).toHaveLength(1);
    expect(screen.getByText("test -f package.json")).toBeTruthy();
    expect(screen.getByText("bun run test")).toBeTruthy();
  });

  it("does not group different tool types together", () => {
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [
        { type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "/a.ts" } },
        { type: "tool_use", id: "tu-2", name: "Bash", input: { command: "ls" } },
      ],
    });
    render(<MessageBubble message={msg} />);

    // Both labels should appear separately
    expect(screen.getByText("Read File")).toBeTruthy();
    expect(screen.queryByText("Terminal")).toBeNull();
    expect(screen.getByText("ls")).toBeTruthy();
  });

  it("renders a single tool_use without group count badge", () => {
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "echo hi" } }],
    });
    render(<MessageBubble message={msg} />);

    expect(screen.queryByText("Terminal")).toBeNull();
    expect(screen.getByText("echo hi")).toBeTruthy();
    expect(screen.queryByText("1")).toBeNull();
  });

  it("groups same tools separated by non-tool blocks into separate groups", () => {
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [
        { type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "/a.ts" } },
        { type: "text", text: "Let me check something else" },
        { type: "tool_use", id: "tu-2", name: "Read", input: { file_path: "/b.ts" } },
      ],
    });
    render(<MessageBubble message={msg} />);

    // The two Read tools should not be grouped since there is a text block between them
    const labels = screen.getAllByText("Read File");
    expect(labels.length).toBe(2);
  });
});
