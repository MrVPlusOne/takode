import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { isReplayableBufferedEvent, shouldBufferForReplayWithContext } from "./replay-buffer-policy.js";

function textDelta(parentToolUseId: string | null): BrowserIncomingMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: parentToolUseId,
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "chunk" } },
  };
}

describe("replay buffer policy", () => {
  it("does not replay-buffer top-level leader text deltas", () => {
    expect(shouldBufferForReplayWithContext(textDelta(null), { isLeaderSession: true })).toBe(false);
    expect(
      isReplayableBufferedEvent(
        {
          seq: 1,
          message: textDelta(null),
        },
        { isLeaderSession: true },
      ),
    ).toBe(false);
  });

  it("keeps worker top-level text deltas and nested leader text deltas replayable", () => {
    expect(shouldBufferForReplayWithContext(textDelta(null), { isLeaderSession: false })).toBe(true);
    expect(shouldBufferForReplayWithContext(textDelta("agent-1"), { isLeaderSession: true })).toBe(true);
  });

  it("keeps non-text leader stream events replayable", () => {
    expect(
      shouldBufferForReplayWithContext(
        {
          type: "stream_event",
          parent_tool_use_id: null,
          event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "reasoning" } },
        },
        { isLeaderSession: true },
      ),
    ).toBe(true);
  });
});
