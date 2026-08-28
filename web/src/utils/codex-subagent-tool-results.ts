import type { BrowserIncomingMessage, ToolResultPreview } from "../types.js";

/** Index self-contained child previews without mixing them into root session tool state. */
export function indexCodexSubagentToolResults(
  messages: readonly BrowserIncomingMessage[],
): Map<string, Map<string, ToolResultPreview>> {
  const byChild = new Map<string, Map<string, ToolResultPreview>>();
  for (const message of messages) {
    if (message.type !== "tool_result_preview" || !message.codexSubagent) continue;
    const results = byChild.get(message.codexSubagent.childId) ?? new Map<string, ToolResultPreview>();
    for (const preview of message.previews) results.set(preview.tool_use_id, preview);
    byChild.set(message.codexSubagent.childId, results);
  }
  return byChild;
}
