import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import { searchSessionMessages } from "./session-message-search.js";

function user(
  id: string,
  content: string,
  timestamp: number,
  options: { threadKey?: string; agentSource?: { sessionId: string; sessionLabel?: string } } = {},
): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content,
    timestamp,
    ...(options.agentSource ? { agentSource: options.agentSource } : {}),
    ...(options.threadKey
      ? {
          threadKey: options.threadKey,
          questId: options.threadKey,
          threadRefs: [{ threadKey: options.threadKey, questId: options.threadKey, source: "explicit" as const }],
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

describe("searchSessionMessages", () => {
  it("searches normal sessions across the whole persisted history", () => {
    const response = searchSessionMessages({
      sessionId: "normal-session",
      sessionNum: 123,
      isLeaderSession: false,
      messageHistory: [
        user("old", "older persisted-only request about constellation search", 10),
        user("new", "newer visible request", 20),
      ],
      query: "constellation",
      scope: "current_thread",
    });

    expect(response.scope).toEqual({ kind: "session", label: "Searching in session #123" });
    expect(response.results.map((result) => result.messageId)).toEqual(["old"]);
    expect(response.results[0]).toMatchObject({
      snippet: expect.stringContaining("constellation"),
      sourceLabel: "Main",
      routeThreadKey: "main",
    });
  });

  it("uses Main thread projection for leader current-thread scope", () => {
    const response = searchSessionMessages({
      sessionId: "leader-session",
      sessionNum: 456,
      isLeaderSession: true,
      messageHistory: [
        user("main", "main apple request", 10),
        user("quest", "quest-only dragonfruit request", 20, { threadKey: "q-1277" }),
      ],
      query: "",
      scope: "current_thread",
      threadKey: "main",
    });

    expect(response.scope).toEqual({ kind: "current_thread", threadKey: "main", label: "Searching in #456 Main" });
    expect(response.results.map((result) => result.messageId)).toEqual(["main"]);
  });

  it("uses quest-thread projection for leader current-thread typed search", () => {
    const response = searchSessionMessages({
      sessionId: "leader-session",
      sessionNum: 456,
      isLeaderSession: true,
      messageHistory: [
        user("main", "main pear request", 10),
        user("quest", "quest pear request", 20, { threadKey: "q-1277" }),
        user("other", "other quest pear request", 30, { threadKey: "q-999" }),
      ],
      query: "pear",
      scope: "current_thread",
      threadKey: "q-1277",
    });

    expect(response.scope).toEqual({
      kind: "current_thread",
      threadKey: "q-1277",
      label: "Searching in #456 thread q-1277",
    });
    expect(response.results.map((result) => result.messageId)).toEqual(["quest"]);
    expect(response.results[0]).toMatchObject({
      sourceLabel: "Thread q-1277",
      routeThreadKey: "q-1277",
      questId: "q-1277",
    });
  });

  it("searches leader across-tabs within the current leader history only", () => {
    const response = searchSessionMessages({
      sessionId: "leader-session",
      sessionNum: 456,
      isLeaderSession: true,
      messageHistory: [
        user("main", "main request", 10),
        user("quest", "quest dragonfruit request", 20, { threadKey: "q-1277" }),
      ],
      query: "",
      scope: "leader_all_tabs",
    });

    expect(response.scope).toEqual({ kind: "leader_all_tabs", label: "Searching in #456 across tabs" });
    expect(response.results.map((result) => result.messageId)).toEqual(["quest", "main"]);
    expect(response.results.map((result) => result.sourceLabel)).toEqual(["Thread q-1277", "Main"]);
  });

  it("applies message type filters and paginates newest recents", () => {
    const response = searchSessionMessages({
      sessionId: "leader-session",
      sessionNum: 456,
      isLeaderSession: true,
      messageHistory: [
        user("user", "user recent", 10),
        assistant("assistant", "assistant recent", 20),
        user("event", "system event", 30, { agentSource: { sessionId: "herd-events" } }),
      ],
      filters: { user: false, assistant: true, event: true },
      limit: 1,
      offset: 0,
    });

    expect(response.totalMatches).toBe(2);
    expect(response.hasMore).toBe(true);
    expect(response.nextOffset).toBe(1);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ messageId: "event", category: "event" });
  });
});
