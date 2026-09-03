import { describe, expect, it } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";

describe("SessionStore routed-answer search excerpts", () => {
  it("preserves routed-answer authority on ordinary assistant rows", () => {
    const threadAnswer = {
      version: 2 as const,
      answerUserMessageIds: ["u1"],
      observedHistoryLength: 1,
    };
    const messages = [
      {
        type: "assistant",
        message: {
          id: "routed-answer",
          role: "assistant",
          model: "test",
          content: [{ type: "text", text: "Answer for search." }],
          stop_reason: "end_turn",
          usage: {},
        },
        parent_tool_use_id: null,
        timestamp: 1500,
        threadKey: "q-42",
        questId: "q-42",
        threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
        leaderThreadRole: "answer",
        threadAnswer,
      },
    ] as PersistedSession["messageHistory"];

    expect(SessionStore.extractSearchExcerpts(messages)).toEqual([
      {
        type: "assistant",
        content: "Answer for search.",
        timestamp: 1500,
        id: "routed-answer",
        threadKey: "q-42",
        questId: "q-42",
        threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
        threadAnswer,
      },
    ]);
  });
});
