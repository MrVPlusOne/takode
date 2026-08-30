import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, ContentBlock } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";
import { buildTurnToolSummary } from "./turn-tool-summary.js";

function assistantWithTools(...names: string[]): BrowserIncomingMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "assistant-1",
      type: "message",
      role: "assistant",
      model: "test",
      content: names.map(
        (name, index) =>
          ({ type: "tool_use", id: `tool-${index}`, name, input: {} }) satisfies Extract<
            ContentBlock,
            { type: "tool_use" }
          >,
      ),
      stop_reason: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

function makeSession(history: BrowserIncomingMessage[]): Session {
  return {
    messageHistory: history,
    messageCountAtTurnStart: 0,
    questStatusAtTurnStart: "refined",
    userMessageIdsThisTurn: [0],
    state: { claimedQuestId: "q-1", claimedQuestStatus: "in_progress" },
  } as unknown as Session;
}

describe("buildTurnToolSummary", () => {
  it("extracts current-turn tools, range, quest transition, and user message ownership", () => {
    const session = makeSession([
      { type: "user_message", content: "work", timestamp: 1, id: "u-1" },
      assistantWithTools("Bash", "Read", "Bash"),
    ]);

    expect(buildTurnToolSummary(session)).toEqual({
      tools: { Bash: 2, Read: 1 },
      msgRange: { from: 0, to: 1 },
      questChange: { questId: "q-1", from: "refined", to: "in_progress" },
      userMsgs: { count: 1, ids: [0] },
    });
  });

  it("keeps the previous result preview bounded", () => {
    const session = makeSession([
      {
        type: "result",
        data: { result: "x".repeat(300) },
      } as unknown as BrowserIncomingMessage,
    ]);
    session.userMessageIdsThisTurn = [];
    session.questStatusAtTurnStart = "in_progress";

    expect(buildTurnToolSummary(session)).toEqual({ resultPreview: "x".repeat(200) });
  });
});
