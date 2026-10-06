// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { groupMessages } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import { NODE_REPL_TOOL_MESSAGES, NODE_REPL_TOOL_RESULTS } from "../test-fixtures/node-repl-tools.js";
import { getPreview, ToolBlock } from "./ToolBlock.js";
import { CompactToolMessageGroups } from "./ToolMessageGroup.js";

beforeEach(() => {
  useStore.setState({ toolResults: new Map(), toolProgress: new Map(), toolStartTimestamps: new Map() });
});

describe("Node REPL call previews", () => {
  it("preserves distinct call titles, grouping, timing and expanded audit details", () => {
    // Use the maintained producer-shaped fixture through real feed grouping,
    // including a failed untitled call; rendering must never run these snippets.
    const groups = groupMessages(NODE_REPL_TOOL_MESSAGES).filter((entry) => entry.kind === "tool_msg_group");
    expect(groups).toHaveLength(1);
    expect(groups[0].toolName).toBe("mcp:node_repl:js");
    expect(groups[0].items.map((item) => item.id)).toEqual([...NODE_REPL_TOOL_RESULTS.keys()]);
    render(
      <CompactToolMessageGroups
        groups={groups}
        sessionId="node-repl-preview"
        isCodexSession
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
        interactionMode="read-only"
        toolResultOverrides={NODE_REPL_TOOL_RESULTS}
        toolResultScope="overrides-only"
      />,
    );

    // Each call is one line titled by its own description; the group has no inner "node_repl:js 3" header.
    expect(screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent)).toEqual([
      "MCPRead the sample window",
      "MCPInspect the sample page and summarize the available entries while preserving the complete descriptive title in the expanded input",
      "MCPnode_repl:jsfailed",
    ]);
    expect(screen.queryByRole("button", { name: /^node_repl:js\s*3$/ })).toBeNull();
    // Opening a line shows its timing and full audit details.
    fireEvent.click(screen.getByRole("button", { name: "Show MCP: Read the sample window" }));
    expect(screen.getByText("1.4s")).toBeTruthy();
    const input = groups[0].items[0].input;
    expect(screen.getByText(JSON.stringify(input, null, 2), { normalizer: (text) => text })).toBeTruthy();
    expect(screen.getByText("Sample window")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show MCP: node_repl:js" }));
    expect(screen.getByText("5.0s")).toBeTruthy();
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.getByText("Sample failure")).toBeTruthy();
  });

  it.each(
    [undefined, null, "", " \n\t ", 42, false, { text: "Object title" }, ["Array title"]].map((title) => ({ title })),
  )("falls back to the tool label for unusable title %j", ({ title }) => {
    // Missing, blank and malformed titles must not erase the per-call header.
    render(<ToolBlock name="mcp:node_repl:js" input={{ title, code: "1 + 1" }} toolUseId="fallback-call" />);
    expect(screen.getByRole("button", { name: "node_repl:js" })).toBeTruthy();
  });

  it("keeps long titles intact and renders markup as ordinary text", () => {
    // CSS handles preview overflow; full input and hover text stay source-faithful.
    const title = `  <img src=x onerror=alert(1)> ${"Detailed description ".repeat(10)}\nfinal line  `;
    expect(getPreview("mcp:node_repl:js", { title })).toBe(title);
    const { container } = render(<ToolBlock name="mcp:node_repl:js" input={{ title }} toolUseId="long-title-call" />);
    expect(container.querySelector("span[title]")?.textContent).toBe(title);
    expect(container.querySelector("span[title]")?.getAttribute("title")).toBe(title);
    expect(container.querySelector("img")).toBeNull();
  });

  it.each(["mcp:node_repl:reset", "mcp:other:js"])("leaves %s previews unchanged", (name) => {
    // A title on unrelated MCP tools does not opt them into this presentation.
    expect(getPreview(name, { title: "Unrelated title" })).toBe("");
  });
});
