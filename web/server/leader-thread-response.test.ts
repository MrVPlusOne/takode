import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  buildLeaderThreadResponseState,
  LeaderThreadResponseConflictError,
  LeaderThreadResponseIdempotencyConflictError,
  publishLeaderThreadResponse,
} from "./leader-thread-response.js";

function session() {
  return { id: "leader-1", messageHistory: [] as BrowserIncomingMessage[] };
}

function human(id: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: `Ask ${id}`,
    timestamp,
    threadKey,
    leaderResponseCoverageVersion: 1,
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }] }),
  };
}

function createResponse(target: ReturnType<typeof session>, threadKey = "main", markdown = "Polished response.") {
  const before = buildLeaderThreadResponseState(target, threadKey);
  const pendingBatchToken = before.pendingBatches[0]?.token;
  if (!pendingBatchToken) throw new Error("expected pending batch");
  return publishLeaderThreadResponse(
    target,
    { intent: "create", threadKey, pendingBatchToken, baseRevisionId: null, markdown },
    { now: 100 + target.messageHistory.length, randomSuffix: `s${target.messageHistory.length}` },
  );
}

describe("leader pending-batch responses", () => {
  it("ignores legacy human history and batches only marked post-cutover messages", () => {
    const target = session();
    target.messageHistory.push(
      { type: "user_message", id: "legacy", content: "Old ask", timestamp: 1, threadKey: "main" },
      human("new-1", 2),
      human("new-2", 3),
    );

    const state = buildLeaderThreadResponseState(target, "main");

    expect(state.projection.cutoverHistoryIndex).toBe(1);
    expect(state.projection.pendingMessageCount).toBe(2);
    expect(state.pendingBatches).toHaveLength(1);
    expect(state.pendingBatches[0]?.userMessageIds).toEqual(["new-1", "new-2"]);
  });

  it("closes the exact observed prefix while newer same-thread messages stay pending", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    const observed = buildLeaderThreadResponseState(target, "main").pendingBatches[0]!;
    target.messageHistory.push(human("u3", 3));

    const result = publishLeaderThreadResponse(
      target,
      {
        intent: "create",
        threadKey: "main",
        pendingBatchToken: observed.token,
        baseRevisionId: null,
        markdown: "Answers the two messages I observed.",
      },
      { now: 4, randomSuffix: "race" },
    );

    expect(result.response.coveredUserMessageIds).toEqual(["u1", "u2"]);
    expect(result.responseState.pendingBatches.map((batch) => batch.userMessageIds)).toEqual([["u3"]]);
    expect(result.responseState.projection.ready).toBe(false);
  });

  it("supports multiple response chains and keeps revisions bound to their original batch", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const first = createResponse(target, "main", "First answer.");
    target.messageHistory.push(human("u2", 5));
    const second = createResponse(target, "main", "Second answer.");

    const revised = publishLeaderThreadResponse(
      target,
      {
        intent: "revise",
        threadKey: "main",
        responseId: first.response.logicalResponseId,
        baseRevisionId: first.response.currentRevisionId,
        markdown: "First answer, polished.",
      },
      { now: 10, randomSuffix: "revise" },
    );

    expect(revised.response.batchId).toBe(first.response.batchId);
    expect(revised.response.coveredUserMessageIds).toEqual(["u1"]);
    const state = buildLeaderThreadResponseState(target, "main");
    expect(state.responses).toHaveLength(2);
    expect(new Set(state.responses.map((response) => response.logicalResponseId))).toEqual(
      new Set([first.response.logicalResponseId, second.response.logicalResponseId]),
    );
    expect(state.projection.ready).toBe(true);
  });

  it("keeps backfill visibility separate from authoritative same-thread coverage", () => {
    const target = session();
    const attached = human("u-main", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    attached.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 2 }];
    target.messageHistory.push(attached);

    expect(buildLeaderThreadResponseState(target, "main").pendingBatches[0]?.userMessageIds).toEqual(["u-main"]);
    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentResponses).toEqual([]);
    expect(buildLeaderThreadResponseState(target, "q-42").projection.pendingMessageCount).toBe(0);
    expect(() => createResponse(target, "q-42", "Wrong-thread answer.")).toThrow("expected pending batch");

    const response = createResponse(target, "main", "Main-thread answer.");
    expect(response.response.coveredUserMessageIds).toEqual(["u-main"]);
    expect(buildLeaderThreadResponseState(target, "main").projection.ready).toBe(true);
  });

  it("fails closed when response content, route, chain, or server batch proof is corrupted", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    const response = createResponse(target);
    const stored = target.messageHistory.at(-1) as Extract<BrowserIncomingMessage, { type: "leader_user_message" }>;

    stored.content = "Tampered response.";
    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(2);
    stored.content = "Polished response.";
    stored.threadResponse!.coveredUserMessageIds = ["u1"];
    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(2);
    stored.threadResponse!.coveredUserMessageIds = ["u1", "u2"];
    stored.threadResponse!.batchObservedHistoryLength += 1;
    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(2);
    expect(response.response.coveredUserMessageIds).toEqual(["u1", "u2"]);
  });

  it("rejects child-owned response revisions from root coverage authority", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const result = createResponse(target);
    result.message.codexSubagent = { childId: "opaque-child", rootTurnId: "root-turn" };

    const state = buildLeaderThreadResponseState(target, "main");
    expect(state.responses).toEqual([]);
    expect(state.projection.pendingMessageCount).toBe(1);
    expect(state.projection.ready).toBe(false);
  });

  it("provides CAS and exact idempotency without accepting a different retry payload", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const pendingBatchToken = buildLeaderThreadResponseState(target, "main").pendingBatches[0]!.token;
    const input = {
      intent: "create" as const,
      threadKey: "main",
      pendingBatchToken,
      baseRevisionId: null,
      markdown: "Stable answer.",
      idempotencyKey: "request-1",
    };
    const first = publishLeaderThreadResponse(target, input, { now: 2, randomSuffix: "same" });
    const retry = publishLeaderThreadResponse(target, input, { now: 3, randomSuffix: "ignored" });

    expect(retry.created).toBe(false);
    expect(retry.message.id).toBe(first.message.id);
    expect(() => publishLeaderThreadResponse(target, { ...input, markdown: "Changed answer." })).toThrow(
      LeaderThreadResponseIdempotencyConflictError,
    );
    expect(() =>
      publishLeaderThreadResponse(target, {
        intent: "revise",
        threadKey: "main",
        responseId: first.response.logicalResponseId,
        baseRevisionId: "stale",
        markdown: "Stale answer.",
      }),
    ).toThrow(LeaderThreadResponseConflictError);
  });

  it("rejects route/status directives but preserves fenced examples and Quiz directives", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const token = buildLeaderThreadResponseState(target, "main").pendingBatches[0]!.token;
    for (const markdown of ["[thread:q-1]\nWrong", "# thread:q-1\nWrong", "{[(Thread Ready: main | done)]}"]) {
      expect(() =>
        publishLeaderThreadResponse(target, {
          intent: "create",
          threadKey: "main",
          pendingBatchToken: token,
          baseRevisionId: null,
          markdown,
        }),
      ).toThrow("cannot contain routing or Thread Waiting/Ready directives");
    }
    const result = publishLeaderThreadResponse(
      target,
      {
        intent: "create",
        threadKey: "main",
        pendingBatchToken: token,
        baseRevisionId: null,
        markdown: "```text\n[thread:q-1]\n```\n\n{[(Quest Quiz: q-1)]}",
      },
      { now: 2, randomSuffix: "quiz" },
    );
    expect(result.message.content).toContain("Quest Quiz");
  });
});
