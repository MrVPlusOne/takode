// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../store.js";
import type { ToolResultPreview } from "../types.js";
import {
  CompactToolActivity,
  isCompactToolActivityItem,
  summarizeToolActivity,
  type CompactToolActivityItem,
} from "./CompactToolActivity.js";

const MIXED_ACTIVITY: CompactToolActivityItem[] = [
  { id: "read-1", name: "Read", input: { file_path: "src/a.ts" } },
  { id: "read-2", name: "Read", input: { file_path: "src/b.ts" } },
  { id: "bash-1", name: "Bash", input: { command: "bun test" } },
  { id: "grep-1", name: "Grep", input: { pattern: "quietMode", path: "src" } },
];

function bashItems(count: number): CompactToolActivityItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `bash-${index + 1}`,
    name: "Bash",
    input: { command: `echo ${index + 1}` },
  }));
}

function mcpItems(count: number): CompactToolActivityItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `mcp-${index + 1}`,
    name: `mcp:slack:tool_${index + 1}`,
    input: { query: `query ${index + 1}` },
  }));
}

const renderDetails = (item: CompactToolActivityItem) => <div>details for {item.id}</div>;

function lineTexts(): string[] {
  return screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent ?? "");
}

function toolResult(id: string, overrides: Partial<ToolResultPreview>): ToolResultPreview {
  return { tool_use_id: id, content: "", is_error: false, total_size: 0, is_truncated: false, ...overrides };
}

beforeEach(() => {
  useStore.setState({ toolResults: new Map(), toolStartTimestamps: new Map(), expandAllInTurn: new Map() });
});

describe("CompactToolActivity", () => {
  it("summarizes a mixed run by intent instead of exposing command previews", () => {
    // The collapsed label should communicate what happened without repeating every tool name or argument.
    expect(summarizeToolActivity(MIXED_ACTIVITY)).toBe("Read files, ran command, searched for quietMode");
  });

  it("includes the number of commands when a run contains several commands", () => {
    // Counts make repeated command-only activity more informative without exposing individual previews.
    expect(
      summarizeToolActivity([
        { id: "bash-1", name: "Bash", input: { command: "git status" } },
        { id: "bash-2", name: "Bash", input: { command: "bun test" } },
        { id: "bash-3", name: "Bash", input: { command: "git diff --check" } },
      ]),
    ).toBe("Ran 3 commands");
  });

  it("labels pure worker sends separately from ordinary Bash commands", () => {
    expect(
      summarizeToolActivity([
        { id: "send-1", name: "Bash", input: { command: 'takode send 17 "Please continue"' } },
        { id: "send-2", name: "Bash", input: { command: "takode send 18 --stdin <<'EOF'\nCheck status.\nEOF" } },
        { id: "bash-1", name: "Bash", input: { command: "git status" } },
      ]),
    ).toBe("Sent 2 messages, ran command");
  });

  it("keeps send counts distinct from the long ordinary-tool fallback", () => {
    expect(
      summarizeToolActivity([
        ...bashItems(7),
        { id: "send-1", name: "Bash", input: { command: 'takode send 17 "Please continue"' } },
        { id: "send-2", name: "Bash", input: { command: 'takode send 18 "Please continue"' } },
      ]),
    ).toBe("7 tool calls, sent 2 messages");
  });

  it("deduplicates replayed send identities without merging their category into commands", () => {
    const send = { id: "send-1", name: "Bash", input: { command: 'takode send 17 "Please continue"' } };
    expect(summarizeToolActivity([send, { ...send }])).toBe("Sent a message");
  });

  it("treats one multiline Bash input as one tool invocation", () => {
    // Shell lines inside one stored tool_use remain one call; rendering must not invent extra boundaries.
    expect(
      summarizeToolActivity([
        {
          id: "bash-multiline",
          name: "Bash",
          input: { command: "pwd\nprintf 'second line\\n'\nbun test" },
        },
      ]),
    ).toBe("Ran command");
  });

  it("falls back to a stable call count for a large Bash run", () => {
    // Large command runs should stop growing descriptive text even though every command remains expandable.
    expect(summarizeToolActivity(bashItems(7))).toBe("7 tool calls");
  });

  it("falls back to a stable call count for many MCP tool names", () => {
    // Distinct MCP names are especially prone to producing long comma-separated summaries.
    expect(summarizeToolActivity(mcpItems(4))).toBe("4 tool calls");
  });

  it("counts mixed Bash and MCP invocations together", () => {
    // The fallback represents actual invocations rather than exposing a partial list of tool categories.
    expect(summarizeToolActivity([...bashItems(4), ...mcpItems(4)])).toBe("8 tool calls");
  });

  it("uses singular copy when one descriptive tool name exceeds the summary budget", () => {
    expect(
      summarizeToolActivity([
        {
          id: "long-mcp",
          name: "mcp:slack:search_messages_with_a_very_long_descriptive_operation_name",
          input: {},
        },
      ]),
    ).toBe("1 tool call");
  });

  it("summarizes worker events as a compact activity category", () => {
    expect(
      summarizeToolActivity([
        { id: "bash-1", name: "Bash", input: { command: "bun test" } },
        { id: "worker-1", name: "SendMessage", kind: "worker_event", input: {} },
        { id: "worker-2", name: "SendMessage", kind: "worker_event", input: {} },
      ]),
    ).toBe("Ran command, 2 worker events");
  });

  it("keeps worker-event counts alongside a large tool-call fallback", () => {
    expect(
      summarizeToolActivity([
        ...bashItems(7),
        { id: "worker-1", name: "SendMessage", kind: "worker_event", input: {} },
        { id: "worker-2", name: "SendMessage", kind: "worker_event", input: {} },
      ]),
    ).toBe("7 tool calls, 2 worker events");
  });

  it("preserves category order when worker events precede a large tool run", () => {
    expect(
      summarizeToolActivity([
        { id: "worker-1", name: "SendMessage", kind: "worker_event", input: {} },
        ...bashItems(7),
      ]),
    ).toBe("1 worker event, 7 tool calls");
  });

  it("does not double-count replayed tool-use identities", () => {
    const items = bashItems(7);
    // Re-delivery of an existing tool_use id is replay noise, not another invocation.
    expect(summarizeToolActivity([...items, { ...items[0] }])).toBe("7 tool calls");
  });

  it("keeps full tool details hidden until a line is opened", () => {
    // Core quiet-view contract: concise by default, with lossless details one click away.
    // Each line opens in place to its own details.
    render(<CompactToolActivity items={MIXED_ACTIVITY} renderDetails={renderDetails} />);

    expect(screen.getByText("Read files, ran command, searched for quietMode")).toBeTruthy();
    expect(screen.queryByText("details for grep-1")).toBeNull();

    const line = screen.getByRole("button", { name: "Show Grep: quietMode in src" });
    fireEvent.click(line);
    expect(screen.getByText("details for grep-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide Grep: quietMode in src" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("updates a large active run as new tool calls arrive", () => {
    // Re-rendering with the producer's append-only active items should advance the count and roll the window.
    const { rerender } = render(<CompactToolActivity items={bashItems(7)} renderDetails={renderDetails} />);
    expect(screen.getByText("7 tool calls")).toBeTruthy();
    expect(screen.getByTestId("compact-tool-activity-earlier").textContent).toBe("+4 earlier");

    rerender(<CompactToolActivity items={bashItems(8)} renderDetails={renderDetails} />);
    expect(screen.getByText("8 tool calls")).toBeTruthy();
    expect(screen.queryByText("7 tool calls")).toBeNull();
    expect(lineTexts()).toEqual(["Bashecho 6", "Bashecho 7", "Bashecho 8"]);
    expect(screen.getByTestId("compact-tool-activity-earlier").textContent).toBe("+5 earlier");
  });

  it("keeps every large-run detail available after expansion", () => {
    render(<CompactToolActivity items={bashItems(7)} renderDetails={renderDetails} />);

    fireEvent.click(screen.getByRole("button", { name: "Show all 7 tool calls: 7 tool calls" }));
    expect(lineTexts()).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Show Bash: echo 1" }));
    expect(screen.getByText("details for bash-1")).toBeTruthy();
  });

  it("labels mixed worker-event activity without calling every item a tool call", () => {
    render(
      <CompactToolActivity
        items={[
          { id: "bash-1", name: "Bash", input: { command: "bun test" } },
          { id: "worker-1", name: "SendMessage", kind: "worker_event", input: { eventCount: 1 } },
          ...bashItems(3).map((item) => ({ ...item, id: `more-${item.id}` })),
        ]}
        renderDetails={renderDetails}
      />,
    );

    expect(screen.getByRole("button", { name: /^Show all 5 activity items/ })).toBeTruthy();
    fireEvent.click(screen.getByTestId("compact-tool-activity-earlier"));
    fireEvent.click(screen.getByRole("button", { name: "Show Event: 1 worker event" }));
    expect(screen.getByText("details for worker-1")).toBeTruthy();
  });

  it("shows a single tool as one light line with its description and no group card", () => {
    // A lone activity hides nothing, so it is just its line; opening it shows the details.
    render(
      <CompactToolActivity
        items={[{ id: "bash-1", name: "Bash", input: { command: "rg flush", description: "Find flush origin" } }]}
        renderDetails={renderDetails}
      />,
    );

    expect(screen.queryByText("Ran command")).toBeNull();
    expect(screen.queryByTestId("compact-tool-activity-earlier")).toBeNull();
    expect(screen.queryByText("details for bash-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Bash: Find flush origin" }));
    expect(screen.getByText("details for bash-1")).toBeTruthy();
  });

  it("shows the newest three activities of a run and folds older ones into +N earlier", () => {
    // The collapsed group is a rolling window: newest work stays visible, height stays capped.
    // Expanding fills the older lines in above without moving the newest ones.
    render(<CompactToolActivity items={bashItems(5)} renderDetails={renderDetails} />);

    expect(lineTexts()).toEqual(["Bashecho 3", "Bashecho 4", "Bashecho 5"]);
    expect(screen.getByTestId("compact-tool-activity-earlier").textContent).toBe("+2 earlier");
    fireEvent.click(screen.getByTestId("compact-tool-activity-earlier"));
    expect(screen.queryByTestId("compact-tool-activity-earlier")).toBeNull();
    expect(lineTexts()).toEqual(["Bashecho 1", "Bashecho 2", "Bashecho 3", "Bashecho 4", "Bashecho 5"]);
  });

  it("keeps the deliberate summary for a single worker send or worker event", () => {
    // These lines use semantic summaries that hide bulky message bodies.
    const { unmount } = render(
      <CompactToolActivity
        items={[{ id: "send-1", name: "Bash", input: { command: 'takode send 17 "Continue"' } }]}
        renderDetails={renderDetails}
      />,
    );
    expect(lineTexts()).toEqual(["SendSent a message"]);
    expect(screen.queryByText(/Continue/)).toBeNull();
    unmount();

    render(
      <CompactToolActivity
        items={[{ id: "worker-1", name: "SendMessage", kind: "worker_event", input: { eventCount: 2 } }]}
        renderDetails={renderDetails}
      />,
    );
    expect(lineTexts()).toEqual(["Event2 worker events"]);
    expect(screen.queryByText("details for worker-1")).toBeNull();
  });

  it("shows thoughts as lines inside the group without counting them as tool calls", () => {
    // Only agent text splits groups, so thinking joins the run as its own line.
    const items: CompactToolActivityItem[] = [
      { id: "thought-1", name: "Thought", kind: "thought", input: { text: "Check the flush path first" } },
      ...bashItems(2),
    ];
    expect(summarizeToolActivity(items)).toBe("Thought, ran 2 commands");
    render(<CompactToolActivity items={items} renderDetails={renderDetails} />);
    expect(lineTexts()).toEqual(["ThoughtCheck the flush path first", "Bashecho 1", "Bashecho 2"]);
  });

  it("marks failed and running lines from the session's tool results", () => {
    // Line status comes from the stored results: an error result is "failed", and a
    // started tool without a result is still running, which hides the total time.
    useStore.setState({
      toolResults: new Map([
        [
          "s1",
          new Map([
            ["bash-1", toolResult("bash-1", { is_error: true, duration_seconds: 2 })],
            ["bash-2", toolResult("bash-2", { duration_seconds: 1 })],
          ]),
        ],
      ]),
      toolStartTimestamps: new Map([["s1", new Map([["bash-3", Date.now()]])]]),
    });
    const { rerender } = render(
      <CompactToolActivity sessionId="s1" items={bashItems(2)} renderDetails={renderDetails} />,
    );
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("3.0s")).toBeTruthy();

    rerender(<CompactToolActivity sessionId="s1" items={bashItems(3)} renderDetails={renderDetails} />);
    expect(screen.queryByText("3.0s")).toBeNull();
  });

  it("shows per-type counts only when a group mixes activity types", () => {
    const { unmount } = render(<CompactToolActivity items={MIXED_ACTIVITY} renderDetails={renderDetails} />);
    expect(screen.getByText("2 Read")).toBeTruthy();
    expect(screen.getByText("1 Grep")).toBeTruthy();
    unmount();

    render(<CompactToolActivity items={bashItems(4)} renderDetails={renderDetails} />);
    expect(screen.queryByText("4 Bash")).toBeNull();
  });

  it("keeps interactive tools visible while allowing notification commands to compact", () => {
    // Notification panels render separately, so their underlying Bash command should remain passive tool activity.
    expect(isCompactToolActivityItem({ id: "ask", name: "AskUserQuestion", input: {} })).toBe(false);
    expect(isCompactToolActivityItem({ id: "plan", name: "ExitPlanMode", input: {} })).toBe(false);
    expect(
      isCompactToolActivityItem({
        id: "notify",
        name: "Bash",
        input: { command: "takode notify review --summary ready" },
      }),
    ).toBe(true);
  });
});
