import { describe, expect, it } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";

describe("SessionStore routed-final search excerpts", () => {
  it("preserves routed-final authority on ordinary assistant rows", () => {
    const threadResponse = {
      logicalResponseId: "routed-response-search",
      revisionId: "routed-response-search-r1",
      revisionNumber: 1,
      batchId: "routed-response-batch-v1.search",
      batchObservedHistoryLength: 1,
      coveredUserMessageIds: ["u1"],
      contentHash: "a".repeat(64),
    };
    const messages = [
      {
        type: "assistant",
        message: {
          id: "routed-final",
          role: "assistant",
          model: "test",
          content: [{ type: "text", text: "Final answer for search." }],
          stop_reason: "end_turn",
          usage: {},
        },
        parent_tool_use_id: null,
        timestamp: 1500,
        threadKey: "q-42",
        questId: "q-42",
        threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
        leaderThreadRole: "response",
        threadResponse,
      },
    ] as PersistedSession["messageHistory"];

    expect(SessionStore.extractSearchExcerpts(messages)).toEqual([
      {
        type: "assistant",
        content: "Final answer for search.",
        timestamp: 1500,
        id: "routed-final",
        threadKey: "q-42",
        questId: "q-42",
        threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
        threadResponse,
      },
    ]);
  });
});
