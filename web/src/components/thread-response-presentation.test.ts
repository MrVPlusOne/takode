import { describe, expect, it } from "vitest";
import { buildFeedModel } from "../hooks/use-feed-model.js";
import type { ChatMessage, LeaderThreadResponseProjection } from "../types.js";
import { buildFeedSections } from "./message-feed-sections.js";
import { resolveThreadResponses } from "./thread-response-presentation.js";

const THREAD_KEY = "q-2024";

function user(id: string, historyIndex: number): ChatMessage {
  return {
    id,
    role: "user",
    content: id,
    timestamp: historyIndex,
    historyIndex,
    metadata: {
      leaderResponseCoverageVersion: 1,
      threadKey: THREAD_KEY,
      questId: THREAD_KEY,
      threadRefs: [{ threadKey: THREAD_KEY, questId: THREAD_KEY, source: "explicit" }],
    },
  };
}

function response(input: {
  id: string;
  logicalResponseId: string;
  revisionId: string;
  revisionNumber: number;
  batchId: string;
  covered: string[];
  historyIndex: number;
  content?: string;
}): ChatMessage {
  return {
    id: input.id,
    role: "assistant",
    content: input.content ?? input.id,
    timestamp: input.historyIndex,
    historyIndex: input.historyIndex,
    metadata: {
      leaderUserMessage: true,
      threadKey: THREAD_KEY,
      questId: THREAD_KEY,
      threadRefs: [{ threadKey: THREAD_KEY, questId: THREAD_KEY, source: "explicit" }],
      threadResponse: {
        logicalResponseId: input.logicalResponseId,
        revisionId: input.revisionId,
        revisionNumber: input.revisionNumber,
        batchId: input.batchId,
        batchObservedHistoryLength: 20,
        coveredUserMessageIds: input.covered,
        contentHash: `hash-${input.revisionId}`,
      },
    },
  };
}

function projection(overrides: Partial<LeaderThreadResponseProjection> = {}): LeaderThreadResponseProjection {
  return {
    version: 1,
    threadKey: THREAD_KEY,
    cutoverHistoryIndex: 10,
    pendingMessageCount: 0,
    pendingBatches: [],
    ready: true,
    currentResponses: [
      {
        version: 1,
        logicalResponseId: "logical-a",
        threadKey: THREAD_KEY,
        questId: THREAD_KEY,
        batchId: "batch-a",
        batchObservedHistoryLength: 20,
        coveredUserMessageIds: ["u1", "u2"],
        currentRevisionId: "a-r2",
        currentMessageId: "a-current",
        currentHistoryIndex: 14,
        revisionCount: 2,
        createdAt: 13,
        updatedAt: 14,
      },
      {
        version: 1,
        logicalResponseId: "logical-b",
        threadKey: THREAD_KEY,
        questId: THREAD_KEY,
        batchId: "batch-b",
        batchObservedHistoryLength: 20,
        coveredUserMessageIds: ["u3"],
        currentRevisionId: "b-r1",
        currentMessageId: "b-current",
        currentHistoryIndex: 16,
        revisionCount: 1,
        createdAt: 16,
        updatedAt: 16,
      },
    ],
    ...overrides,
  };
}

function sections(messages: ChatMessage[]) {
  return buildFeedSections(buildFeedModel(messages, true).turns, 30);
}

function validMessages(): ChatMessage[] {
  return [
    user("u1", 10),
    user("u2", 11),
    response({
      id: "a-old",
      logicalResponseId: "logical-a",
      revisionId: "a-r1",
      revisionNumber: 1,
      batchId: "batch-a",
      covered: ["u1", "u2"],
      historyIndex: 13,
    }),
    response({
      id: "a-current",
      logicalResponseId: "logical-a",
      revisionId: "a-r2",
      revisionNumber: 2,
      batchId: "batch-a",
      covered: ["u1", "u2"],
      historyIndex: 14,
    }),
    user("u3", 15),
    response({
      id: "b-current",
      logicalResponseId: "logical-b",
      revisionId: "b-r1",
      revisionNumber: 1,
      batchId: "batch-b",
      covered: ["u3"],
      historyIndex: 16,
      content: "Final response\n\n{[(Quest Quiz: q-2024)]}",
    }),
  ];
}

describe("pending-batch thread response presentation", () => {
  it("maps each current response after its batch's last prompt and separates Quiz", () => {
    const result = resolveThreadResponses(sections(validMessages()), projection(), THREAD_KEY);

    expect(result?.currentResponses.map((item) => [item.response.logicalResponseId, item.anchorUserMessageId])).toEqual(
      [
        ["logical-a", "u2"],
        ["logical-b", "u3"],
      ],
    );
    expect(result?.currentResponses[1]?.collapsedMessageEntry.msg.content).toBe("Final response");
    expect(result?.quizQuestIds).toEqual(["q-2024"]);
    expect(result?.quizHostTurnId).toBe("u3");
  });

  it("fails closed for overlapping coverage or a mismatched current revision", () => {
    const overlap = projection({
      currentResponses: [
        ...projection().currentResponses,
        {
          ...projection().currentResponses[1]!,
          logicalResponseId: "logical-c",
          currentMessageId: "b-current",
          coveredUserMessageIds: ["u2"],
        },
      ],
    });
    expect(resolveThreadResponses(sections(validMessages()), overlap, THREAD_KEY)).toBeNull();

    const mismatch = projection({
      currentResponses: [
        { ...projection().currentResponses[0]!, currentRevisionId: "wrong" },
        projection().currentResponses[1]!,
      ],
    });
    expect(resolveThreadResponses(sections(validMessages()), mismatch, THREAD_KEY)).toBeNull();
  });

  it("does not transfer Main response authority through a quest backfill reference", () => {
    const backfilledMain: ChatMessage = {
      id: "main-backfill",
      role: "user",
      content: "Main-owned context",
      timestamp: 17,
      historyIndex: 17,
      metadata: {
        leaderResponseCoverageVersion: 1,
        threadKey: "main",
        threadRefs: [{ threadKey: THREAD_KEY, questId: THREAD_KEY, source: "backfill" }],
      },
    };

    expect(
      resolveThreadResponses(sections([...validMessages(), backfilledMain]), projection(), THREAD_KEY),
    ).not.toBeNull();
  });

  it("keeps pre-cutover, unsupported, and All Threads states on the normal fallback", () => {
    expect(
      resolveThreadResponses(sections(validMessages()), projection({ cutoverHistoryIndex: 12 }), THREAD_KEY),
    ).toBeNull();
    expect(resolveThreadResponses(sections(validMessages()), undefined, THREAD_KEY)).toBeNull();
    expect(resolveThreadResponses(sections(validMessages()), projection(), "all")).toBeNull();
  });
});
