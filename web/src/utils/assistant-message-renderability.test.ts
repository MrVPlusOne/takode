import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import {
  isAssistantMessageRenderable,
  projectAssistantMessageForRendering,
} from "./assistant-message-renderability.js";

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    timestamp: 1,
    ...overrides,
  };
}

describe("assistant message renderability", () => {
  it("suppresses the live status-only empty-text-block producer shape", () => {
    const message = assistant({
      contentBlocks: [{ type: "text", text: "" }],
      turnDurationMs: 18_253,
      metadata: {
        threadRefs: [{ threadKey: "q-1869", questId: "q-1869", source: "explicit" }],
        threadStatusMarkers: [
          {
            kind: "waiting",
            label: "Thread Waiting",
            threadKey: "q-1869",
            questId: "q-1869",
            summary: "calculating cache ETA",
            messageId: "assistant-1",
            timestamp: 1,
            updatedAt: 1,
          },
        ],
      },
    });

    expect(isAssistantMessageRenderable(message)).toBe(false);
  });

  it("strips valid routing and status marker text before deciding", () => {
    const projection = projectAssistantMessageForRendering(
      assistant({
        content: "[thread:q-1869]\n{[(Thread Waiting: q-1869 | calculating cache ETA)]}",
        contentBlocks: [
          {
            type: "text",
            text: "[thread:q-1869]\n{[(Thread Waiting: q-1869 | calculating cache ETA)]}",
          },
        ],
      }),
    );

    expect(projection.blocks).toEqual([]);
    expect(projection.fallbackText).toBe("");
    expect(projection.renderable).toBe(false);
  });

  it("keeps prose, tools, results, thinking, images, notifications, and rendered child state", () => {
    const cases = [
      assistant({ contentBlocks: [{ type: "text", text: "Visible prose" }] }),
      assistant({ contentBlocks: [{ type: "tool_use", id: "tool-1", name: "Bash", input: {} }] }),
      assistant({ contentBlocks: [{ type: "tool_result", tool_use_id: "tool-1", content: "" }] }),
      assistant({ contentBlocks: [{ type: "thinking", thinking: "Visible reasoning" }] }),
      assistant({ images: [{ imageId: "image-1", media_type: "image/png" }] }),
      assistant({ notification: { id: "n-1", category: "needs-input", timestamp: 1 } }),
      assistant({ metadata: { codexReasoningDetail: { status: "complete" } } }),
    ];

    for (const message of cases) expect(isAssistantMessageRenderable(message)).toBe(true);
    expect(isAssistantMessageRenderable(assistant(), { hasAnchoredNotification: true })).toBe(true);
    expect(isAssistantMessageRenderable(assistant(), { hasVisibleSideChat: true })).toBe(true);
  });

  it("suppresses hidden tools, empty thinking, and root Codex thinking-only rows", () => {
    expect(
      isAssistantMessageRenderable(
        assistant({ contentBlocks: [{ type: "tool_use", id: "hidden", name: "write_stdin", input: {} }] }),
      ),
    ).toBe(false);
    expect(isAssistantMessageRenderable(assistant({ contentBlocks: [{ type: "thinking", thinking: "  " }] }))).toBe(
      false,
    );
    expect(
      isAssistantMessageRenderable(
        assistant({
          content: "provider thinking fallback",
          contentBlocks: [{ type: "thinking", thinking: "provider thinking fallback" }],
        }),
        { isCodexSession: true },
      ),
    ).toBe(false);
  });

  it("keeps quiz directives eligible for their dedicated rendered child", () => {
    expect(isAssistantMessageRenderable(assistant({ content: "{[(Quest Quiz: q-1888)]}" }))).toBe(true);
  });
});
