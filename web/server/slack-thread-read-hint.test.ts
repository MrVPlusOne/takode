import { describe, expect, it } from "vitest";
import {
  claudeEmptySlackThreadHook,
  EMPTY_SLACK_THREAD_HINT,
  isEmptySlackThreadRead,
} from "./slack-thread-read-hint.js";

// What `slack_read_thread` returned for a message with no replies (a live read
// of a reply inside another thread, Nov 20), detailed and concise.
const EMPTY_DETAILED = JSON.stringify({
  messages:
    "=== THREAD PARENT MESSAGE ===\nFrom: Wenxu Mao (U0AM9ST0TL1)\nTime: 2026-11-20 15:44:08 PST\nMessage TS: 1795218248.073529\nno restart?\n\nNo thread messsages\n",
  pagination_info: "There are no more messages in this thread.\n",
});
const EMPTY_CONCISE = JSON.stringify({
  messages: "THREAD: no restart? [Wenxu Mao]\n\nNo thread messsages\n",
  pagination_info: "There are no more messages in this thread.\n",
});
const WITH_REPLIES = JSON.stringify({
  messages:
    "=== THREAD PARENT MESSAGE ===\nFrom: Junhong Shen (U1)\nTime: 14:20 PST\nMessage TS: 1.000001\nrebuild?\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\nFrom: Jiayi Wei (U2)\nTime: 14:21 PST\nMessage TS: 2.000001\nin place",
  pagination_info: "There are no more messages in this thread.\n",
});
const input = { channel_id: "C7", message_ts: "1795218248.073529" };

describe("isEmptySlackThreadRead", () => {
  it("recognizes a read that found only the message asked for, in any response shape", () => {
    // Claude Code may hand the hook the text, content blocks, or an object holding them.
    expect(isEmptySlackThreadRead(input, EMPTY_DETAILED)).toBe(true);
    expect(isEmptySlackThreadRead(input, [{ type: "text", text: EMPTY_CONCISE }])).toBe(true);
    expect(
      isEmptySlackThreadRead(input, {
        content: [{ type: "text", text: EMPTY_DETAILED }],
      }),
    ).toBe(true);
  });

  it("leaves threads with replies and reads limited to part of a thread alone", () => {
    expect(isEmptySlackThreadRead(input, WITH_REPLIES)).toBe(false);
    // With `oldest`, Slack shows only the first message when nothing newer came: that is no sign of a missed thread.
    expect(isEmptySlackThreadRead({ ...input, oldest: "1795218000.000000" }, EMPTY_DETAILED)).toBe(false);
    expect(isEmptySlackThreadRead({ ...input, cursor: "x" }, EMPTY_DETAILED)).toBe(false);
  });
});

describe("claudeEmptySlackThreadHook", () => {
  const run = (event: Record<string, unknown>) =>
    claudeEmptySlackThreadHook.hooks[0]!(event as never, "tu-1", {
      signal: new AbortController().signal,
    });

  it("adds the note to an empty thread read from any Slack MCP server", async () => {
    for (const toolName of ["mcp__slack__slack_read_thread", "mcp__claude_ai_Slack__slack_read_thread"]) {
      expect(
        await run({
          hook_event_name: "PostToolUse",
          tool_name: toolName,
          tool_input: input,
          tool_response: EMPTY_DETAILED,
        }),
      ).toEqual({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: EMPTY_SLACK_THREAD_HINT,
        },
      });
    }
    // The SDK filters by this pattern before calling the hook.
    expect(new RegExp(claudeEmptySlackThreadHook.matcher!).test("mcp__slack__slack_read_thread")).toBe(true);
    expect(new RegExp(claudeEmptySlackThreadHook.matcher!).test("mcp__slack__slack_read_channel")).toBe(false);
  });

  it("adds nothing to other results or tools", async () => {
    const event = {
      hook_event_name: "PostToolUse",
      tool_name: "mcp__slack__slack_read_thread",
      tool_input: input,
    };
    expect(await run({ ...event, tool_response: WITH_REPLIES })).toEqual({});
    expect(
      await run({
        ...event,
        tool_name: "mcp__slack__slack_read_channel",
        tool_response: EMPTY_DETAILED,
      }),
    ).toEqual({});
  });
});
