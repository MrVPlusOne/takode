import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, ContentBlock } from "../server/session-types.js";
import { buildLeaderProjectionSnapshot, collectLeaderThreadSummaries } from "./leader-projection.js";
import {
  appendLeaderThreadRouteIndex,
  buildLeaderThreadRouteIndex,
  buildRawTurnBoundariesFromRouteIndex,
  collectLeaderThreadSummariesFromRouteIndex,
  leaderThreadRouteIndexMatchesSource,
} from "./leader-thread-route-index.js";

function user(id: string, content: string, timestamp: number, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content,
    timestamp,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
    ...(threadKey ? { threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] } : {}),
  };
}

function assistant(id: string, content: ContentBlock[], timestamp: number, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
    ...(threadKey ? { threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] } : {}),
  };
}

function result(id: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "result",
    id,
    subtype: "success",
    is_error: false,
    duration_ms: 10,
    duration_api_ms: 10,
    num_turns: 1,
    result: "done",
    total_cost_usd: 0,
    timestamp,
  } as BrowserIncomingMessage;
}

function marker(id: string, timestamp: number, sourceThreadKey: string, threadKey: string): BrowserIncomingMessage {
  return {
    type: "thread_transition_marker",
    id,
    markerKey: id,
    timestamp,
    sourceThreadKey,
    sourceQuestId: sourceThreadKey,
    threadKey,
    questId: threadKey,
    transitionedAt: timestamp,
    reason: "route_switch",
  } as BrowserIncomingMessage;
}

function fixtureHistory(): BrowserIncomingMessage[] {
  return [
    user("u-main", "Main request", 1),
    assistant("a-prefix", [{ type: "text", text: "[thread:q-101]\nWork on scoped thread" }], 2),
    result("r-1", 3),
    user("u-direct", "Direct quest thread", 4, "q-100"),
    assistant(
      "a-bash",
      [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "# thread:q-102\nquest show q-102" } }],
      5,
    ),
    marker("move-q-103", 6, "q-102", "q-103"),
    user("u-open", "[thread:q-104]\nStill running", 7),
  ];
}

describe("leader thread-route index", () => {
  it("keeps incremental thread routes and turn boundaries equal to a full rebuild", () => {
    const history = fixtureHistory();
    const incremental = appendLeaderThreadRouteIndex(
      appendLeaderThreadRouteIndex(buildLeaderThreadRouteIndex(history.slice(0, 3)), history.slice(3, 6)),
      history.slice(6),
    );
    const rebuilt = buildLeaderThreadRouteIndex(history);

    expect(collectLeaderThreadSummariesFromRouteIndex(incremental)).toEqual(
      collectLeaderThreadSummariesFromRouteIndex(rebuilt),
    );
    expect(buildRawTurnBoundariesFromRouteIndex(incremental)).toEqual(buildRawTurnBoundariesFromRouteIndex(rebuilt));
    expect(collectLeaderThreadSummariesFromRouteIndex(incremental)).toEqual(collectLeaderThreadSummaries(history));
    expect(buildRawTurnBoundariesFromRouteIndex(incremental)).toEqual([
      { turnIndex: 0, startHistoryIndex: 0, endHistoryIndex: 2 },
      { turnIndex: 1, startHistoryIndex: 3, endHistoryIndex: 5 },
      { turnIndex: 2, startHistoryIndex: 6, endHistoryIndex: null },
    ]);
  });

  it("detects stale, unsupported, and same-length mismatched indexes", () => {
    const history = fixtureHistory();
    const index = buildLeaderThreadRouteIndex(history);
    const stale = buildLeaderThreadRouteIndex(history.slice(0, -1));
    const unsupported = { ...index, schemaVersion: 99 as 1 };
    const sameLengthMismatch = history.map((message, idx) =>
      idx === 1 ? assistant("a-prefix", [{ type: "text", text: "[thread:q-999]\nChanged" }], 2) : message,
    );

    expect(leaderThreadRouteIndexMatchesSource(index, history)).toBe(true);
    expect(leaderThreadRouteIndexMatchesSource(stale, history)).toBe(false);
    expect(leaderThreadRouteIndexMatchesSource(unsupported, history)).toBe(false);
    expect(leaderThreadRouteIndexMatchesSource(index, sameLengthMismatch)).toBe(false);
  });

  it("lets leader projection use a valid index and fall back to full scans for stale indexes", () => {
    const history = fixtureHistory();
    const expected = buildLeaderProjectionSnapshot({
      leaderSessionId: "leader-1",
      messageHistory: history,
      generatedAt: 123,
      revision: 1,
    });

    const withIndex = buildLeaderProjectionSnapshot({
      leaderSessionId: "leader-1",
      messageHistory: history,
      threadRouteIndex: buildLeaderThreadRouteIndex(history),
      generatedAt: 123,
      revision: 1,
    });

    const withStaleIndex = buildLeaderProjectionSnapshot({
      leaderSessionId: "leader-1",
      messageHistory: history,
      threadRouteIndex: buildLeaderThreadRouteIndex(history.slice(0, 3)),
      generatedAt: 123,
      revision: 1,
    });

    expect(withIndex.threadSummaries).toEqual(expected.threadSummaries);
    expect(withIndex.rawTurnBoundaries).toEqual(expected.rawTurnBoundaries);
    expect(withStaleIndex.threadSummaries).toEqual(expected.threadSummaries);
    expect(withStaleIndex.rawTurnBoundaries).toEqual(expected.rawTurnBoundaries);
  });

  it("stress-tests synthetic quest-thread batches without private session data", () => {
    const history: BrowserIncomingMessage[] = [];
    for (let index = 0; index < 750; index++) {
      const questId = `q-${100 + (index % 17)}`;
      history.push(user(`u-${index}`, `[thread:${questId}]\nmessage ${index}`, index * 3 + 1));
      history.push(assistant(`a-${index}`, [{ type: "text", text: `reply ${index}` }], index * 3 + 2, questId));
      if (index % 3 === 0) history.push(result(`r-${index}`, index * 3 + 3));
    }

    let incremental = buildLeaderThreadRouteIndex([]);
    for (let offset = 0; offset < history.length; offset += 37) {
      incremental = appendLeaderThreadRouteIndex(incremental, history.slice(offset, offset + 37));
    }
    const rebuilt = buildLeaderThreadRouteIndex(history);

    expect(incremental.sourceHistoryLength).toBe(history.length);
    expect(collectLeaderThreadSummariesFromRouteIndex(incremental)).toEqual(
      collectLeaderThreadSummariesFromRouteIndex(rebuilt),
    );
    expect(buildRawTurnBoundariesFromRouteIndex(incremental)).toEqual(buildRawTurnBoundariesFromRouteIndex(rebuilt));
  });
});
