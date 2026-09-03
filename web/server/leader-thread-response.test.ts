import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
  leaderThreadResponseContentHash,
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

function routedAssistant(
  id: string,
  text: string,
  observedHistoryLength: number | undefined,
  threadKey = "main",
  role: "commentary" | "response" = "response",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 100,
    threadKey,
    leaderThreadRole: role,
    ...(observedHistoryLength === undefined ? {} : { leaderResponseObservedHistoryLength: observedHistoryLength }),
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }] }),
  };
}

function appendFinal(
  target: ReturnType<typeof session>,
  id: string,
  text: string,
  observedHistoryLength: number,
  threadKey = "main",
) {
  const message = routedAssistant(id, text, observedHistoryLength, threadKey);
  target.messageHistory.push(message);
  const result = finalizeRoutedLeaderResponseMessage(target, message);
  expect(result).toMatchObject({ finalized: true });
  return message;
}

function legacyBatchId(sessionId: string, threadKey: string, historyLength: number, ids: string[]): string {
  const encoded = Buffer.from(JSON.stringify({ v: 1, t: threadKey, h: historyLength, ids })).toString("base64url");
  const checksum = createHash("sha256").update(`${sessionId}\n${encoded}`).digest("hex").slice(0, 24);
  return `response-batch-v1.${encoded}.${checksum}`;
}

function legacyResponse(
  target: ReturnType<typeof session>,
  id: string,
  text: string,
  coveredIds: string[],
  observedHistoryLength: number,
  threadKey = "main",
): Extract<BrowserIncomingMessage, { type: "leader_user_message" }> {
  const logicalResponseId = `legacy-${id}`;
  const message: Extract<BrowserIncomingMessage, { type: "leader_user_message" }> = {
    type: "leader_user_message",
    id,
    content: text,
    timestamp: 50,
    threadKey,
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }] }),
    threadResponse: {
      logicalResponseId,
      revisionId: `${logicalResponseId}-r1`,
      revisionNumber: 1,
      batchId: legacyBatchId(target.id, threadKey, observedHistoryLength, coveredIds),
      batchObservedHistoryLength: observedHistoryLength,
      coveredUserMessageIds: coveredIds,
      contentHash: leaderThreadResponseContentHash(text),
    },
  };
  target.messageHistory.push(message);
  return message;
}

describe("routed leader final responses", () => {
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
    expect(state.projection.pendingBatches[0]).not.toHaveProperty("batchId");
    expect(state.projection.pendingBatches[0]).not.toHaveProperty("legacyBatchId");
  });

  it("covers only the exact turn-observed prefix while later queued input stays pending", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    const observedHistoryLength = target.messageHistory.length;
    target.messageHistory.push(human("u3", 3));
    const response = appendFinal(target, "final-1", "Answers only what this turn observed.", observedHistoryLength);

    expect(response.threadResponse?.coveredUserMessageIds).toEqual(["u1", "u2"]);
    expect(response.threadResponse?.batchId).toMatch(/^routed-response-batch-v1\./);
    expect(response.threadResponse?.batchId).not.toMatch(/^response-batch-v1\./);
    expect(buildLeaderThreadResponseState(target, "main").pendingBatches.map((batch) => batch.userMessageIds)).toEqual([
      ["u3"],
    ]);
  });

  it("creates a new response after newer observed input and keeps earlier chains current", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const first = appendFinal(target, "final-1", "First answer.", 1);
    target.messageHistory.push(human("u2", 5));
    const second = appendFinal(target, "final-2", "Second answer.", 3);

    const state = buildLeaderThreadResponseState(target, "main");
    expect(state.responses).toHaveLength(2);
    expect(state.responses.map((response) => response.currentMessageId)).toEqual([first.message.id, second.message.id]);
    expect(state.projection.ready).toBe(true);
  });

  it("supersedes repeated finals for the same observed batch", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const first = appendFinal(target, "final-1", "First wording.", 1);
    const second = appendFinal(target, "final-2", "Polished wording.", 1);

    const state = buildLeaderThreadResponseState(target, "main");
    expect(state.responses).toHaveLength(1);
    expect(state.responses[0]).toMatchObject({
      currentMessageId: second.message.id,
      revisionCount: 2,
      coveredUserMessageIds: ["u1"],
    });
    expect(second.threadResponse).toMatchObject({
      logicalResponseId: first.threadResponse?.logicalResponseId,
      parentRevisionId: first.threadResponse?.revisionId,
      revisionNumber: 2,
    });
  });

  it("keeps backfill visibility separate from authoritative same-thread coverage", () => {
    const target = session();
    const attached = human("u-main", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    attached.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 2 }];
    target.messageHistory.push(attached);

    expect(buildLeaderThreadResponseState(target, "main").pendingBatches[0]?.userMessageIds).toEqual(["u-main"]);
    expect(buildLeaderThreadResponseState(target, "q-42").projection.pendingMessageCount).toBe(0);
    const wrongThread = routedAssistant("wrong", "Wrong-thread answer.", 1, "q-42");
    target.messageHistory.push(wrongThread);
    expect(finalizeRoutedLeaderResponseMessage(target, wrongThread)).toMatchObject({
      finalized: false,
      reason: "invalid_message",
    });

    appendFinal(target, "main-final", "Main-thread answer.", 1);
    expect(buildLeaderThreadResponseState(target, "main").projection.ready).toBe(true);
  });

  it("does not let commentary satisfy a pending batch", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const commentary = routedAssistant("commentary", "Still working.", 1, "main", "commentary");
    target.messageHistory.push(commentary);

    expect(finalizeRoutedLeaderResponseMessage(target, commentary)).toEqual({
      finalized: false,
      reason: "not_response",
    });
    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 1,
      ready: false,
      currentResponses: [],
    });
  });

  it("fails closed on unproven, tool-bearing, conflicting-control, child, or detached response rows", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));

    const unproven = routedAssistant("unproven", "Answer.", undefined);
    target.messageHistory.push(unproven);
    expect(finalizeRoutedLeaderResponseMessage(target, unproven)).toMatchObject({ reason: "unproven_observation" });

    const toolBearing = routedAssistant("tool-bearing", "Answer.", 1);
    toolBearing.message.content.push({ type: "tool_use", id: "tool", name: "Bash", input: { command: "true" } });
    target.messageHistory.push(toolBearing);
    expect(finalizeRoutedLeaderResponseMessage(target, toolBearing)).toMatchObject({ reason: "invalid_message" });

    const conflicting = routedAssistant("conflicting", "[thread:main:C] Conflicting role.", 1);
    target.messageHistory.push(conflicting);
    expect(finalizeRoutedLeaderResponseMessage(target, conflicting)).toMatchObject({ reason: "invalid_message" });

    const child = routedAssistant("child", "Child answer.", 1);
    child.codexSubagent = { childId: "opaque-child", rootTurnId: "root-turn" };
    target.messageHistory.push(child);
    expect(finalizeRoutedLeaderResponseMessage(target, child)).toMatchObject({ reason: "invalid_message" });

    const detached = routedAssistant("detached", "Detached answer.", 1);
    expect(finalizeRoutedLeaderResponseMessage(target, detached)).toMatchObject({ reason: "invalid_message" });
    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(1);
  });

  it("rejects every unfenced marker-like directive while allowing fenced examples", () => {
    for (const [id, text] of [
      ["valid-route", "Answer.\n[thread:q-2:F]\nMisrouted continuation."],
      ["missing-role", "Answer.\n[thread:q-2]\nMissing role."],
      ["invalid-role", "Answer.\n[thread:q-2:X]\nInvalid role."],
      ["unknown-target", "Answer.\n[thread:side:F]\nUnknown target."],
    ] as const) {
      const target = session();
      target.messageHistory.push(human("u1", 1));
      const response = routedAssistant(id, text, 1);
      target.messageHistory.push(response);

      expect(finalizeRoutedLeaderResponseMessage(target, response)).toMatchObject({
        finalized: false,
        reason: "invalid_message",
      });
      expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(1);
    }

    const fencedTarget = session();
    fencedTarget.messageHistory.push(human("u1", 1));
    const fenced = routedAssistant("fenced-example", "Example:\n```text\n[thread:q-2:X]\n```", 1);
    fencedTarget.messageHistory.push(fenced);

    expect(finalizeRoutedLeaderResponseMessage(fencedTarget, fenced)).toMatchObject({ finalized: true });
    expect(buildLeaderThreadResponseState(fencedTarget, "main").projection.pendingMessageCount).toBe(0);
  });

  it("is idempotent for the same stored assistant row and does not create another revision", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const response = appendFinal(target, "stable-final", "Stable answer.", 1);

    expect(finalizeRoutedLeaderResponseMessage(target, response)).toEqual({
      finalized: false,
      reason: "already_finalized",
    });
    expect(buildLeaderThreadResponseState(target, "main").responses[0]?.revisionCount).toBe(1);
  });

  it("keeps valid legacy dedicated response rows readable and rejects corrupted legacy proof", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    const response = legacyResponse(target, "legacy-final", "Legacy answer.", ["u1", "u2"], 2);

    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 0,
      ready: true,
      currentResponses: [{ currentMessageId: "legacy-final", coveredUserMessageIds: ["u1", "u2"] }],
    });

    response.content = "Tampered response.";
    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 2,
      ready: false,
      currentResponses: [],
    });
  });
});
