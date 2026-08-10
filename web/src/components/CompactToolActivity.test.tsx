// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps full tool details hidden until the summary is expanded", () => {
    // This verifies the core quiet-view contract: concise by default, with lossless details one click away.
    render(
      <CompactToolActivity items={MIXED_ACTIVITY}>
        <div>Full command and result details</div>
      </CompactToolActivity>,
    );

    expect(screen.getByText("Read files, ran command, searched for quietMode")).toBeTruthy();
    expect(screen.queryByText("Full command and result details")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show 4 tool calls/ }));
    expect(screen.getByText("Full command and result details")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hide 4 tool calls/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("updates a large active run as new tool calls arrive", () => {
    // Re-rendering with the producer's append-only active items should advance the visible count immediately.
    const { rerender } = render(
      <CompactToolActivity items={bashItems(7)}>
        <div>Seven command details</div>
      </CompactToolActivity>,
    );
    expect(screen.getByText("7 tool calls")).toBeTruthy();

    rerender(
      <CompactToolActivity items={bashItems(8)}>
        <div>Eight command details</div>
      </CompactToolActivity>,
    );
    expect(screen.getByText("8 tool calls")).toBeTruthy();
    expect(screen.queryByText("7 tool calls")).toBeNull();
  });

  it("keeps every large-run detail available after expansion", () => {
    render(
      <CompactToolActivity items={bashItems(7)}>
        {bashItems(7).map((item) => (
          <div key={item.id}>{String(item.input.command)} result</div>
        ))}
      </CompactToolActivity>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show 7 tool calls/ }));
    expect(screen.getByText("echo 1 result")).toBeTruthy();
    expect(screen.getByText("echo 7 result")).toBeTruthy();
  });

  it("labels mixed worker-event activity without calling every item a tool call", () => {
    render(
      <CompactToolActivity
        items={[
          { id: "bash-1", name: "Bash", input: { command: "bun test" } },
          { id: "worker-1", name: "SendMessage", kind: "worker_event", input: {} },
        ]}
      >
        <div>Full worker-event details</div>
      </CompactToolActivity>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show 2 activity items/ }));
    expect(screen.getByText("Full worker-event details")).toBeTruthy();
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
