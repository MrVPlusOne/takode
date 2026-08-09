import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import { buildFeedModel } from "../hooks/use-feed-model.js";
import { stripRootCodexThinkingMessages } from "./assistant-content-blocks.js";

describe("stripRootCodexThinkingMessages", () => {
  it("removes root-only rows and adjusts the visible frozen prefix", () => {
    // Defensive feed sanitation may receive pre-fix state whose frozen count still includes the hidden row.
    const messages: ChatMessage[] = [
      {
        id: "root-thinking",
        role: "assistant",
        content: "Stale root reasoning",
        contentBlocks: [{ type: "thinking", thinking: "Stale root reasoning" }],
        timestamp: 1,
      },
      { id: "visible", role: "user", content: "Visible row", timestamp: 2 },
    ];

    const stripped = stripRootCodexThinkingMessages(messages, 2);
    expect(stripped.messages.map((message) => message.id)).toEqual(["visible"]);
    expect(stripped.frozenCount).toBe(1);
  });

  it("classifies a legacy mixed reasoning and tool message as tool-only activity", () => {
    // Sanitation must precede feed modeling so stale reasoning text does not split compact tool runs.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "Inspect", timestamp: 1 },
      {
        id: "mixed",
        role: "assistant",
        content: "Stale root reasoning",
        contentBlocks: [
          { type: "thinking", thinking: "Stale root reasoning" },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "git status" } },
        ],
        timestamp: 2,
      },
    ];

    const stripped = stripRootCodexThinkingMessages(messages, 0);
    expect(stripped.messages[1]).toMatchObject({ content: "", contentBlocks: [{ type: "tool_use" }] });
    expect(buildFeedModel(stripped.messages).entries.map((entry) => entry.kind)).toEqual(["message", "tool_msg_group"]);
  });
});
