import { describe, expect, it } from "vitest";
import {
  searchGlobalStarredMessages,
  type GlobalStarredMessageSearchDocument,
} from "./global-starred-message-search.js";
import type { BrowserIncomingMessage, StarredMessageRecord } from "./session-types.js";

function user(id: string, content: string, timestamp: number, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content,
    timestamp,
    ...(threadKey
      ? {
          threadKey,
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }],
        }
      : {}),
  };
}

function assistant(id: string, text: string, timestamp: number, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    ...(threadKey
      ? {
          threadKey,
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }],
        }
      : {}),
  };
}

function star(
  messageId: string,
  role: StarredMessageRecord["role"],
  historyIndex: number,
  timestamp: number,
  starredAt: number,
  threadKey = "main",
): StarredMessageRecord {
  return {
    messageId,
    role,
    historyIndex,
    sourceThreadKey: threadKey,
    routeThreadKey: threadKey,
    timestamp,
    starredAt,
    ...(threadKey !== "main" ? { questId: threadKey } : {}),
  };
}

function doc(overrides: Partial<GlobalStarredMessageSearchDocument>): GlobalStarredMessageSearchDocument {
  return {
    sessionId: "s1",
    sessionNum: 1,
    state: "connected",
    name: "Session",
    archived: false,
    messageHistory: [],
    starredMessages: {},
    ...overrides,
  };
}

describe("searchGlobalStarredMessages", () => {
  it("uses starred sidecar records and sorts empty searches by most recently starred", () => {
    const response = searchGlobalStarredMessages({
      docs: [
        doc({
          sessionId: "s-old",
          sessionNum: 12,
          name: "Old",
          messageHistory: [user("old", "older visible starred note", 10)],
          starredMessages: { old: star("old", "user", 0, 10, 100) },
        }),
        doc({
          sessionId: "s-new",
          sessionNum: 13,
          name: "New",
          messageHistory: [assistant("new", "newer visible starred note", 20, "q-1539")],
          starredMessages: { new: star("new", "assistant", 0, 20, 200, "q-1539") },
        }),
      ],
    });

    expect(response.results.map((result) => result.messageId)).toEqual(["new", "old"]);
    expect(response.results[0]).toMatchObject({
      sessionId: "s-new",
      sessionNum: 13,
      sessionName: "New",
      category: "assistant",
      starred: true,
      starredAt: 200,
      sourceThreadKey: "q-1539",
      routeThreadKey: "q-1539",
      sourceLabel: "Thread q-1539",
      questId: "q-1539",
    });
  });

  it("searches archived search-only excerpts and includes archived reviewer context", () => {
    const response = searchGlobalStarredMessages({
      query: "dragonfruit",
      docs: [
        doc({
          sessionId: "s-review",
          sessionNum: 41,
          name: "Review archive",
          state: "exited",
          archived: true,
          archivedAt: 123,
          reviewerOf: 40,
          searchExcerpts: [
            {
              type: "assistant",
              id: "a-archived",
              content: "Archived reviewer note about dragonfruit routing",
              timestamp: 50,
            },
          ],
          starredMessages: { "a-archived": star("a-archived", "assistant", 7, 50, 500) },
        }),
        doc({
          sessionId: "s-nonmatch",
          sessionNum: 42,
          searchExcerpts: [{ type: "user_message", id: "u-other", content: "plain pear note", timestamp: 60 }],
          starredMessages: { "u-other": star("u-other", "user", 1, 60, 600) },
        }),
      ],
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      sessionId: "s-review",
      sessionName: "Review archive",
      archived: true,
      archivedAt: 123,
      reviewerOf: 40,
      sessionState: "exited",
      messageId: "a-archived",
      routeThreadKey: "main",
      sourceThreadKey: "main",
      snippet: expect.stringContaining("dragonfruit"),
    });
  });

  it("ignores stale sidecar records when neither history nor excerpts can resolve the stable target", () => {
    const response = searchGlobalStarredMessages({
      docs: [
        doc({
          messageHistory: [user("other", "other content", 10)],
          starredMessages: { missing: star("missing", "user", 0, 10, 100) },
        }),
      ],
    });

    expect(response.results).toEqual([]);
  });
});
