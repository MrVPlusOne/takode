import type { ChatMessage, ToolResultPreview } from "../types.js";

// Matches CodexItemEventManager's MCP projection: mcp:server:tool with the
// original argument object, one stored tool_use per invocation. Display only.
export const NODE_REPL_TOOL_MESSAGES: ChatMessage[] = [
  { title: "Read the sample window", code: 'nodeRepl.write({ label: "sample window" });' },
  {
    title:
      "Inspect the sample page and summarize the available entries while preserving the complete descriptive title in the expanded input",
    code: 'nodeRepl.write(["First entry", "Second entry"]);',
  },
  { code: 'throw new Error("Sample failure");' },
].map((input, index) => ({
  id: `node-repl-message-${index + 1}`,
  role: "assistant",
  content: "",
  timestamp: 1_790_000_000_000 + index * 1_000,
  contentBlocks: [{ type: "tool_use", id: `node-repl-call-${index + 1}`, name: "mcp:node_repl:js", input }],
}));

export const NODE_REPL_TOOL_RESULTS = new Map<string, ToolResultPreview>(
  [
    { tool_use_id: "node-repl-call-1", content: "Sample window", is_error: false, duration_seconds: 1.4 },
    { tool_use_id: "node-repl-call-2", content: "First entry\nSecond entry", is_error: false, duration_seconds: 18 },
    { tool_use_id: "node-repl-call-3", content: "Sample failure", is_error: true, duration_seconds: 5 },
  ].map((result) => [result.tool_use_id, { ...result, is_truncated: false, total_size: result.content.length }]),
);
