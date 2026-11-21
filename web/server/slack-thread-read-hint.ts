import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";

/**
 * Slack's `slack_read_thread` prints "No thread messages" both for a message
 * nobody replied to and for a reply inside another thread, which it shows alone
 * as if it started a thread, never naming the parent. Agents have read that as
 * "there was no discussion" when the discussion was in the parent's thread, or
 * in the thread of a neighboring message. A note added to such a result says
 * how to look further.
 */
export const EMPTY_SLACK_THREAD_HINT =
  "Takode note: Slack shows no replies under this message. Slack's thread reader answers this way for a message " +
  "nobody replied to, and also for a reply inside another thread, which it shows alone without naming the thread. " +
  "The discussion may also be in the thread of a nearby message. Before concluding there was no discussion, read the " +
  "conversation around this message with `slack_read_channel` (`oldest` and `latest` a few minutes either side; " +
  "`Thread: N replies` marks messages that have threads), or search the conversation near that time: a search " +
  "result's permalink shows `thread_ts=<first message>` for a reply.";

/**
 * Whether a `slack_read_thread` call returned only the message asked for. A
 * read limited by `oldest`, `latest` or a page cursor can legitimately show no
 * replies, so only unbounded reads count.
 */
export function isEmptySlackThreadRead(toolInput: unknown, toolResponse: unknown): boolean {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  if (input.oldest !== undefined || input.latest !== undefined || input.cursor !== undefined) return false;
  // The response shape differs by Claude Code version (text, content blocks, JSON);
  // Slack's phrase, with its own spelling ("messsages"), survives any of them.
  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse ?? "");
  return /No thread mes+ages/i.test(text);
}

/** Claude PostToolUse hook that adds `EMPTY_SLACK_THREAD_HINT` to an empty `slack_read_thread` result. */
export const claudeEmptySlackThreadHook: HookCallbackMatcher = {
  // MCP tools are named `mcp__<server>__<tool>`; the Slack server's name depends on how it was added.
  matcher: "mcp__.*__slack_read_thread",
  hooks: [
    async (input) => {
      if (input.hook_event_name !== "PostToolUse" || !/__slack_read_thread$/.test(input.tool_name)) return {};
      if (!isEmptySlackThreadRead(input.tool_input, input.tool_response)) return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse" as const,
          additionalContext: EMPTY_SLACK_THREAD_HINT,
        },
      };
    },
  ],
};
