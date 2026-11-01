import { describe, expect, it } from "vitest";
import { searchUserMessages, type UserMessageSearchSource } from "./user-message-search.js";
import { setTopicViewSource } from "./topic-views.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { SessionActivityRecord } from "./activity-stream.js";
import { STANDARD_COMPACTION_RECOVERY_PREFIX } from "../shared/injected-event-message.js";

/**
 * Search of the user's own messages across every session: only what a person typed counts, matches
 * order by strength then newest, archived sessions come from their activity records, and a live
 * history's messages are found once and extended as it grows.
 */

function user(id: string, content: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return { type: "user_message", id, content, timestamp, ...extra } as BrowserIncomingMessage;
}

function source(sessionId: string, history: BrowserIncomingMessage[], extra: Partial<UserMessageSearchSource> = {}) {
  return {
    sessionId,
    sessionNum: Number(sessionId.replace(/\D/g, "")) || null,
    sessionName: `Session ${sessionId}`,
    archived: false,
    isOrchestrator: false,
    history,
    ...extra,
  } satisfies UserMessageSearchSource;
}

describe("searchUserMessages", () => {
  it("finds the user's own messages in every session, not leader, herd or Takode messages", () => {
    const leader = source(
      "s1",
      [
        user("a", "Please add a marker to the chart", 10, { threadKey: "q-12" }),
        // A leader's instruction to its worker arrives as a user message with an agent source.
        user("b", "Add the marker now", 20, { agentSource: { sessionId: "s1", sessionLabel: "#1" } }),
      ],
      { isOrchestrator: true },
    );
    const worker = source("s2", [
      user("c", "the marker is too small", 30),
      user("d", "[Thread routing reminder] Missing thread marker on visible leader text.", 40, {
        agentSource: { sessionId: "system:thread-routing-reminder" },
      }),
      // Takode's own prompts carry no agent source but are not the user's words either.
      user("e", `${STANDARD_COMPACTION_RECOVERY_PREFIX} recover the marker context.`, 50),
    ]);

    const response = searchUserMessages({ sources: [leader, worker], query: "marker" });

    expect(response.results.map((result) => result.messageId)).toEqual(["c", "a"]);
    expect(response.results[1]).toMatchObject({
      sessionId: "s1",
      sessionName: "Session s1",
      routeThreadKey: "q-12",
      questId: "q-12",
      category: "user",
    });
    expect(response.results[0]).toMatchObject({ sessionId: "s2", routeThreadKey: "main", sourceLabel: "Main" });
  });

  it("orders by match strength, then newest first, and lists every message newest first with no query", () => {
    const sources = [
      source("s1", [
        user("phrase-old", "restart the server please", 10),
        user("apart-new", "server, then restart", 50),
      ]),
      source("s2", [user("phrase-new", "restart server", 30)]),
    ];

    expect(searchUserMessages({ sources, query: "restart server" }).results.map((r) => r.messageId)).toEqual([
      "phrase-new",
      "phrase-old",
      "apart-new",
    ]);
    const all = searchUserMessages({ sources, limit: 2 });
    expect(all.results.map((r) => r.messageId)).toEqual(["apart-new", "phrase-new"]);
    expect(all).toMatchObject({ totalMatches: 3, nextOffset: 2, hasMore: true });
    expect(searchUserMessages({ sources, limit: 2, offset: 2 }).results.map((r) => r.messageId)).toEqual([
      "phrase-old",
    ]);
  });

  it("finds messages added to a history since the last search", () => {
    // The first search keeps the history's user messages; later ones only read what was appended.
    const history = [user("a", "first note about tokens", 10)];
    const sources = [source("s1", history)];
    expect(searchUserMessages({ sources, query: "tokens" }).totalMatches).toBe(1);
    history.push(user("b", "second note about tokens", 20));
    expect(searchUserMessages({ sources, query: "tokens" }).results.map((r) => r.messageId)).toEqual(["b", "a"]);
  });

  it("reads an archived session from its activity record, taking message IDs from its excerpts", () => {
    const record: SessionActivityRecord = {
      version: 1,
      isOrchestrator: true,
      asks: [
        { index: 4, at: 100, text: "move the marker left", thread: "q-7" },
        { index: 9, at: 200, text: "and the marker colour", thread: "main" },
      ],
      answers: [],
      unrequested: [],
    };
    const archived = source("s3", [], {
      archived: true,
      history: undefined,
      record,
      excerpts: [
        { type: "user_message", id: "m4", content: "move the marker left", timestamp: 100 },
        { type: "assistant", id: "x", content: "marker", timestamp: 150 },
      ],
    });

    const response = searchUserMessages({ sources: [archived], query: "marker" });

    expect(response.results.map((r) => [r.messageId, r.routeThreadKey])).toEqual([
      // No excerpt for the second message: it keeps a placeholder ID and is still found.
      ["history-9", "main"],
      ["m4", "q-7"],
    ]);
    expect(response.results[1]).toMatchObject({ archived: true, questId: "q-7", historyIndex: 4 });
  });
  it("names a thread's conversation, following joins, and never shows a topic: address", () => {
    // Jiayi (Nov 1): thread links read "topic:70747109". A thread joined onto an earlier one is that
    // conversation now; a thread the server can't name reads "Thread".
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "aaaa0001"
          ? { id: "aaaa0001", name: "Seeded QA plan", thread: {} }
          : handle === "bbbb0002"
            ? { id: "bbbb0002", name: "Follow-up", thread: { joinedInto: "topic:aaaa0001" } }
            : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    try {
      const leader = source(
        "s1",
        [
          user("joined", "check the plan", 10, { threadKey: "topic:bbbb0002" }),
          user("unknown", "check the old plan", 20, { threadKey: "topic:99999999" }),
        ],
        { isOrchestrator: true },
      );
      const results = searchUserMessages({ sources: [leader], query: "plan" }).results;
      expect(results.map((r) => [r.messageId, r.routeThreadKey, r.sourceLabel])).toEqual([
        ["unknown", "topic:99999999", "Thread"],
        ["joined", "topic:aaaa0001", 'Thread "Seeded QA plan"'],
      ]);
      expect(results[1]!.sourceThreadKey).toBe("topic:bbbb0002");
    } finally {
      setTopicViewSource(null);
    }
  });
});
