import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, SessionNotification } from "./session-types.js";
import {
  buildRecentAskBundles,
  consumeRecentAskVisibleResponseBoundary,
  markRecentAskVisibleResponseFromStream,
  type RecentAskSessionDocument,
} from "./recent-ask-bundles.js";

function user(id: string, content: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp, threadKey };
}

function injected(id: string, content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp, agentSource: { sessionId: "timer:t1" } };
}

function assistant(id: string, text: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    threadKey,
  };
}

function toolOnly(id: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "tool_use", id: `tool-${id}`, name: "Read", input: {} }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
  };
}

function result(options: { error?: boolean; interrupted?: boolean; retry?: boolean } = {}): BrowserIncomingMessage {
  return {
    type: "result",
    interrupted: options.interrupted,
    data: {
      type: "result",
      subtype: options.error ? "error_during_execution" : "success",
      is_error: options.error === true,
      ...(options.retry
        ? {
            codex_provider_retry: {
              family: "model_backend_stream_error",
              ownerId: "u1",
              attempt: 1,
              maxAttempts: 2,
              startedAt: 10,
            },
          }
        : {}),
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: "result-1",
      session_id: "s1",
    },
  };
}

function doc(
  messages: BrowserIncomingMessage[],
  overrides: Partial<RecentAskSessionDocument> = {},
): RecentAskSessionDocument {
  return {
    sessionId: "s1",
    sessionNum: 1,
    sessionName: "One",
    sessionState: "connected",
    archived: false,
    sessionSpaceId: "default",
    sessionSpaceName: "Default",
    messageHistory: messages,
    isOrchestrator: true,
    ...overrides,
  };
}

describe("recent ask streamed response boundaries", () => {
  it("records only top-level visible text streams for the active owner thread", () => {
    const session = {
      activeTurnRoute: { threadKey: "q-7", questId: "q-7" },
      recentAskVisibleResponseThreads: new Set<string>(),
    };
    expect(
      markRecentAskVisibleResponseFromStream(session, {
        type: "stream_event",
        parent_tool_use_id: null,
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Visible" } },
      }),
    ).toBe(true);
    expect(consumeRecentAskVisibleResponseBoundary(session, "main")).toBe(false);
    expect(consumeRecentAskVisibleResponseBoundary(session, "q-7")).toBe(true);
    expect(consumeRecentAskVisibleResponseBoundary(session, "q-7")).toBe(false);

    expect(
      markRecentAskVisibleResponseFromStream(session, {
        type: "stream_event",
        parent_tool_use_id: "tool",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Nested" } },
      }),
    ).toBe(false);
    expect(
      markRecentAskVisibleResponseFromStream(session, {
        type: "stream_event",
        parent_tool_use_id: null,
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Hidden" } },
      }),
    ).toBe(false);
  });
});

describe("buildRecentAskBundles", () => {
  it("collapses repeated same-destination asks to the newest direct-human message", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc([
          user("u1", "Start the work", 10),
          toolOnly("tool", 11),
          injected("timer", "automatic reminder", 12),
          user("u2", "Also cover mobile", 13),
          assistant("a1", "Done", 14),
          user("u3", "One follow-up", 15),
        ]),
      ],
    });

    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]).toMatchObject({
      id: "s1:main",
      ownerThreadKey: "main",
      status: "awaiting_response",
    });
    expect(response.groups[0]?.members.map((member) => member.messageId)).toEqual(["u3"]);
    expect(response.groups[0]?.response).toBeUndefined();
  });

  it("keeps persisted stream boundaries from changing destination identity", () => {
    const second = user("u2", "Correction after streamed text", 11) as Extract<
      BrowserIncomingMessage,
      { type: "user_message" }
    >;
    second.recentAskBoundaryBefore = "visible_response";
    const response = buildRecentAskBundles({ documents: [doc([user("u1", "Initial", 10), second])] });
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]).toMatchObject({ id: "s1:main", members: [{ messageId: "u2" }] });
  });

  it("does not let a response in another thread close the active bundle", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc([
          user("u1", "Quest ask", 10, "q-1"),
          assistant("a-main", "Main update", 11, "main"),
          user("u2", "Quest clarification", 12, "q-1"),
          assistant("a-quest", "Quest response", 13, "q-1"),
        ]),
      ],
    });
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]?.members.map((member) => member.messageId)).toEqual(["u2"]);
    expect(response.groups[0]?.response?.messageId).toBe("a-quest");
  });

  it("preserves exact member whitespace and allows automatic retry to settle", () => {
    const response = buildRecentAskBundles({
      documents: [doc([user("u1", "  Line one\n\n  Line two  ", 10), result({ retry: true }), result()])],
    });
    expect(response.groups[0]?.members[0]?.preview).toBe("  Line one\n\n  Line two  ");
    expect(response.groups[0]?.status).toBe("responded");
  });

  it("splits on owner-thread changes and respects later attachment ownership", () => {
    const first = user("u1", "Main ask", 10);
    first.threadRefs = [{ threadKey: "q-10", questId: "q-10", source: "explicit", attachedAt: 20 }];
    const response = buildRecentAskBundles({
      documents: [doc([first, user("u2", "Quest ask", 11, "q-10"), user("u3", "Back to Main", 12)])],
    });

    expect(response.groups.map((group) => group.ownerThreadKey)).toEqual(["main", "q-10"]);
    expect(response.groups[1]).toMatchObject({ id: "s1:q-10", ownerThreadKey: "q-10" });
    expect(response.groups[1]?.members.map((member) => member.messageId)).toEqual(["u2"]);
  });

  it("uses persisted result ownership instead of failing a queued bundle in another thread", () => {
    const failedResult = result({ error: true });
    failedResult.threadKey = "q-1";
    failedResult.questId = "q-1";
    const response = buildRecentAskBundles({
      documents: [doc([user("u1", "Active quest", 10, "q-1"), user("u2", "Queued quest", 11, "q-2"), failedResult])],
    });
    expect(response.groups.find((group) => group.ownerThreadKey === "q-1")?.status).toBe("failed");
    expect(response.groups.find((group) => group.ownerThreadKey === "q-2")?.status).toBe("awaiting_response");
  });

  it("uses terminal failure and automatic retry boundaries conservatively", () => {
    const failed = buildRecentAskBundles({ documents: [doc([user("u1", "Try", 10), result({ error: true })])] });
    expect(failed.groups[0]?.status).toBe("failed");

    const retrying = buildRecentAskBundles({ documents: [doc([user("u1", "Try", 10), result({ retry: true })])] });
    expect(retrying.groups[0]?.status).toBe("retrying");

    const interrupted = buildRecentAskBundles({
      documents: [doc([user("u1", "Try", 10), result({ interrupted: true }), user("u2", "Retry", 11)])],
    });
    expect(interrupted.groups).toHaveLength(1);
    expect(interrupted.groups[0]).toMatchObject({ status: "awaiting_response", members: [{ messageId: "u2" }] });
  });

  it("derives active and queued status from exact member ownership", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc([user("u1", "Active", 10), user("u2", "Queued", 11, "q-2")], {
          isGenerating: true,
          userMessageIdsThisTurn: [0],
          queuedTurnUserMessageIds: [[1]],
          activeTurnRoute: { threadKey: "main" },
        }),
      ],
    });
    expect(response.groups.find((group) => group.members[0]?.messageId === "u1")?.status).toBe("working");
    expect(response.groups.find((group) => group.members[0]?.messageId === "u2")?.status).toBe("queued");
  });

  it("requires exact response receipts for per-bundle unread and supports thread-level needs input", () => {
    const notifications: SessionNotification[] = [
      {
        id: "review",
        category: "review",
        timestamp: 20,
        messageId: "a1",
        done: false,
        threadKey: "main",
      },
      {
        id: "needs",
        category: "needs-input",
        summary: "Choose a direction",
        timestamp: 30,
        messageId: null,
        done: false,
        threadKey: "q-2",
      },
    ];
    const response = buildRecentAskBundles({
      documents: [
        doc([user("u1", "Main ask", 10), assistant("a1", "Main reply", 12), user("u2", "Quest ask", 25, "q-2")], {
          notifications,
        }),
      ],
    });
    expect(response.groups.find((group) => group.ownerThreadKey === "main")?.status).toBe("response_unread");
    expect(response.groups.find((group) => group.ownerThreadKey === "q-2")?.status).toBe("thread_needs_input");
  });

  it("uses thread-level needs input when the notification anchor is not the bundle response", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc([user("u1", "Ask", 10), assistant("a1", "Reply", 11)], {
          notifications: [
            {
              id: "needs",
              category: "needs-input",
              summary: "Choose one",
              timestamp: 12,
              messageId: "different-anchor",
              done: false,
              threadKey: "main",
            },
          ],
        }),
      ],
    });
    expect(response.groups[0]?.status).toBe("thread_needs_input");
  });

  it("stops before scanning ancient history once the recent bundle window is known", () => {
    const ancient = Array.from({ length: 5_000 }, (_, index) => ({
      type: "compact_marker" as const,
      id: `ancient-${index}`,
      timestamp: index,
      summary: "old",
    }));
    const recent = Array.from({ length: 55 }, (_, index) => [
      user(`u${index}`, `Ask ${index}`, 10_000 + index * 2),
      assistant(`a${index}`, `Reply ${index}`, 10_001 + index * 2),
    ]).flat();
    let indexedReads = 0;
    const history = new Proxy([...ancient, ...recent], {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const response = buildRecentAskBundles({ documents: [doc(history, { isOrchestrator: false })] });
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]?.members[0]?.messageId).toBe("u54");
    expect(indexedReads).toBeLessThan(1_000);
  });

  it("uses explicit Questmaster completion without overriding higher-priority attention", () => {
    const quests = new Map([["q-9", { questId: "q-9", title: "Done quest", status: "done" }]]);
    const completed = buildRecentAskBundles({
      documents: [doc([user("u1", "Finish", 10, "q-9"), assistant("a1", "Finished", 11, "q-9")])],
      quests,
    });
    expect(completed.groups[0]).toMatchObject({ questTitle: "Done quest", questStatus: "done", status: "completed" });

    const unread = buildRecentAskBundles({
      documents: [
        doc([user("u1", "Finish", 10, "q-9"), assistant("a1", "Finished", 11, "q-9")], {
          notifications: [
            { id: "r1", category: "review", timestamp: 12, messageId: "a1", threadKey: "q-9", done: false },
          ],
        }),
      ],
      quests,
    });
    expect(unread.groups[0]?.status).toBe("response_unread");
  });

  it("coerces every normal-session ask to one Main conversation", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc([user("u1", "Tagged legacy ask", 10, "q-1"), user("u2", "Newest normal ask", 20, "q-2")], {
          isOrchestrator: false,
        }),
      ],
    });

    expect(response.groups).toEqual([
      expect.objectContaining({
        id: "s1:main",
        ownerThreadKey: "main",
        members: [expect.objectContaining({ messageId: "u2" })],
      }),
    ]);
    expect(response.groups[0]?.questId).toBeUndefined();
  });

  it("keeps the same quest tab in different leader sessions as distinct destinations", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc([user("leader-one", "First leader", 10, "q-7")], { sessionId: "leader-1" }),
        doc([user("leader-two", "Second leader", 20, "q-7")], { sessionId: "leader-2" }),
      ],
    });

    expect(response.groups.map((group) => group.id)).toEqual(["leader-2:q-7", "leader-1:q-7"]);
    expect(response.groups.every((group) => group.ownerThreadKey === "q-7")).toBe(true);
  });

  it("uses the newest authoritative attachment and never emits All Threads as an owner", () => {
    const attached = user("attached", "Moved ask", 10, "q-1");
    attached.threadRefs = [
      { threadKey: "q-1", questId: "q-1", source: "explicit", attachedAt: 10 },
      { threadKey: "q-99", questId: "q-99", source: "backfill", attachedAt: 99 },
      { threadKey: "q-2", questId: "q-2", source: "explicit", attachedAt: 20 },
      { threadKey: "all", source: "explicit", attachedAt: 30 },
    ];
    const aggregate = user("aggregate", "Legacy aggregate ask", 20, "all");
    aggregate.threadRefs = [{ threadKey: "all", source: "explicit", attachedAt: 40 }];

    const response = buildRecentAskBundles({ documents: [doc([attached, aggregate])] });

    expect(response.groups.map((group) => group.ownerThreadKey)).toEqual(["main", "q-2"]);
    expect(response.groups.find((group) => group.ownerThreadKey === "q-2")).toMatchObject({
      id: "s1:q-2",
      questId: "q-2",
      members: [{ messageId: "attached" }],
    });
    expect(response.groups.some((group) => group.ownerThreadKey === "all")).toBe(false);
  });

  it("collapses duplicate destinations before applying the requested limit", () => {
    const repeated = Array.from({ length: 60 }, (_, index) => [
      user(`repeat-${index}`, `Repeated ${index}`, 100 + index * 2, "q-2"),
      assistant(`repeat-response-${index}`, "Done", 101 + index * 2, "q-2"),
    ]).flat();
    const response = buildRecentAskBundles({
      documents: [doc([user("older-destination", "Older destination", 10, "q-1"), ...repeated])],
      limit: 2,
    });

    expect(response.groups).toHaveLength(2);
    expect(response.groups.map((group) => group.ownerThreadKey)).toEqual(["q-2", "q-1"]);
    expect(response.groups[0]?.members).toEqual([expect.objectContaining({ messageId: "repeat-59" })]);
  });

  it("keeps attention and activity filters as independent destination facets", () => {
    const document = doc(
      [
        user("old", "Older ask", 10, "q-7"),
        assistant("old-response", "Answer", 11, "q-7"),
        user("new", "Newest ask", 20, "q-7"),
      ],
      {
        notifications: [
          {
            id: "needs",
            category: "needs-input",
            summary: "Choose one",
            timestamp: 12,
            messageId: "old-response",
            done: false,
            threadKey: "q-7",
          },
          {
            id: "review",
            category: "review",
            summary: "New answer",
            timestamp: 13,
            messageId: "old-response",
            done: false,
            threadKey: "q-7",
          },
        ],
      },
    );

    const all = buildRecentAskBundles({ documents: [document] });
    expect(all.groups[0]).toMatchObject({
      status: "needs_input",
      statusDetail: "Choose one",
      members: [{ messageId: "new" }],
      response: { messageId: "old-response" },
    });
    expect(buildRecentAskBundles({ documents: [document], filter: "needs_me" }).groups).toHaveLength(1);
    expect(buildRecentAskBundles({ documents: [document], filter: "new_response" }).groups).toHaveLength(1);
    expect(buildRecentAskBundles({ documents: [document], filter: "active" }).groups).toHaveLength(1);
  });

  it("ignores stale unanchored needs-input after a newer ask", () => {
    const document = doc([user("newest", "Newest ask", 20, "q-7")], {
      notifications: [
        {
          id: "stale-thread-needs-input",
          category: "needs-input",
          summary: "Old prompt",
          timestamp: 10,
          messageId: null,
          done: false,
          threadKey: "q-7",
        },
      ],
    });

    const all = buildRecentAskBundles({ documents: [document] });
    expect(all.attentionCount).toBe(0);
    expect(all.groups[0]?.status).toBe("awaiting_response");
    expect(buildRecentAskBundles({ documents: [document], filter: "needs_me" }).groups).toHaveLength(0);
  });

  it("excludes muted unresolved needs-input prompts from Recent attention", () => {
    const document = doc([user("ask", "Completed ask", 10), assistant("response", "Answer", 11)], {
      notifications: [
        {
          id: "muted-needs-input",
          category: "needs-input",
          summary: "Muted backlog",
          timestamp: 12,
          messageId: "response",
          done: false,
          muted: true,
          mutedAt: 13,
          threadKey: "main",
        },
      ],
    });

    const all = buildRecentAskBundles({ documents: [document] });
    expect(all.attentionCount).toBe(0);
    expect(all.groups[0]?.status).toBe("responded");
    expect(all.groups[0]?.statusDetail).toBeUndefined();
    expect(buildRecentAskBundles({ documents: [document], filter: "needs_me" }).groups).toHaveLength(0);
  });

  it("requires an exact same-destination response before exposing a review facet", () => {
    const document = doc(
      [
        user("quest-one", "Quest one", 10, "q-1"),
        user("quest-two", "Quest two", 20, "q-2"),
        assistant("quest-two-response", "Answer", 21, "q-2"),
      ],
      {
        notifications: [
          {
            id: "wrong-owner-review",
            category: "review",
            timestamp: 22,
            messageId: "quest-two-response",
            done: false,
            threadKey: "q-1",
          },
        ],
      },
    );

    const response = buildRecentAskBundles({ documents: [document], filter: "new_response" });
    expect(response.groups).toHaveLength(0);
  });

  it("bounds globally after destination collapse, sorts by latest human input, and ignores query text", () => {
    const response = buildRecentAskBundles({
      documents: [
        doc(
          Array.from({ length: 60 }, (_, index) => [
            user(`u${index}`, `Ask ${index}`, index * 2, `q-${index + 1}`),
            assistant(`a${index}`, `Reply ${index}`, index * 2 + 1, `q-${index + 1}`),
          ]).flat(),
        ),
      ],
      query: "does not match any ask",
      omittedSearchOnlySessions: 2,
    });
    expect(response.query).toBe("");
    expect(response.totalRecentGroups).toBe(50);
    expect(response.groups).toHaveLength(50);
    expect(response.groups[0]?.members[0]?.messageId).toBe("u59");
    expect(response.groups.at(-1)?.members[0]?.messageId).toBe("u10");
    expect(response.coverageNotice).toContain("archived sessions");
  });
});
