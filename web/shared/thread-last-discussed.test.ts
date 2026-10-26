import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import { findThreadLastDiscussedMessageId } from "./thread-window.js";

/**
 * A quest's topic link opens the topic conversation where the quest was last discussed: the start
 * of the quest's part in the newest leader turn that touched it.
 */
function user(id: string, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: 1,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
  };
}

function assistant(id: string, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude",
      content: [{ type: "text", text: id }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
  };
}

function result(): BrowserIncomingMessage {
  return { type: "result", data: { subtype: "success" } } as unknown as BrowserIncomingMessage;
}

describe("findThreadLastDiscussedMessageId", () => {
  it("lands on the message that opened the quest's newest turn, not an earlier turn or its last row", () => {
    // Two turns about q-5; Main and q-7 come after. The newest q-5 turn starts at u4.
    const history = [
      user("u1", "q-5"),
      assistant("a1", "q-5"),
      result(),
      user("u4", "q-5"),
      assistant("a4", "q-5"),
      assistant("a5", "q-5"),
      result(),
      user("u7"),
      assistant("a7"),
      result(),
      user("u10", "q-7"),
      result(),
    ];
    expect(findThreadLastDiscussedMessageId(history, "q-5")).toBe("u4");
    expect(findThreadLastDiscussedMessageId(history, "Q-7")).toBe("u10");
  });

  it("starts at the quest's first message of that turn when the turn began elsewhere", () => {
    // The user asked in Main; the leader then worked on q-5 inside that turn.
    const history = [user("u1"), assistant("a1"), assistant("a2", "q-5"), assistant("a3", "q-5"), result()];
    expect(findThreadLastDiscussedMessageId(history, "q-5")).toBe("a2");
  });

  it("skips messages the feed leaves out and says null for a quest never discussed", () => {
    const history = [user("u1", "q-5"), assistant("a1", "q-5"), result(), user("hidden", "q-5")];
    const include = (message: BrowserIncomingMessage) => !(message.type === "user_message" && message.id === "hidden");
    expect(findThreadLastDiscussedMessageId(history, "q-5", include)).toBe("u1");
    expect(findThreadLastDiscussedMessageId(history, "q-9")).toBeNull();
  });
});
