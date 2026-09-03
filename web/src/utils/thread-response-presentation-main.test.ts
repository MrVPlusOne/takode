import { describe, expect, it } from "vitest";
import { buildFeedModel } from "../hooks/use-feed-model.js";
import type { ChatMessage, LeaderThreadResponseProjection } from "../types.js";
import { buildFeedSections } from "../components/message-feed-sections.js";
import { resolveThreadResponses } from "../components/thread-response-presentation.js";

function user(id: string, historyIndex: number): ChatMessage {
  return {
    id,
    role: "user",
    content: id,
    timestamp: historyIndex,
    historyIndex,
    metadata: { threadKey: "main", leaderResponseCoverageVersion: 1 },
  };
}

function mainResponse(): ChatMessage {
  return {
    id: "main-response-r1",
    role: "assistant",
    content: "Main response\n\n{[(Quest Quiz: q-8)]}\n{[(Quest Quiz: q-8)]}",
    timestamp: 12,
    historyIndex: 12,
    metadata: {
      leaderUserMessage: true,
      threadKey: "main",
      threadResponse: {
        logicalResponseId: "main-logical",
        revisionId: "main-r1",
        revisionNumber: 1,
        batchId: "main-batch",
        batchObservedHistoryLength: 13,
        coveredUserMessageIds: ["u1", "u2"],
        contentHash: "main-hash",
      },
    },
  };
}

function mainState(overrides: Partial<LeaderThreadResponseProjection> = {}): LeaderThreadResponseProjection {
  return {
    version: 1,
    threadKey: "main",
    cutoverHistoryIndex: 10,
    pendingMessageCount: 0,
    pendingBatches: [],
    ready: true,
    currentResponses: [
      {
        version: 1,
        logicalResponseId: "main-logical",
        threadKey: "main",
        batchId: "main-batch",
        batchObservedHistoryLength: 13,
        coveredUserMessageIds: ["u1", "u2"],
        currentRevisionId: "main-r1",
        currentMessageId: "main-response-r1",
        currentHistoryIndex: 12,
        revisionCount: 1,
        createdAt: 12,
        updatedAt: 12,
      },
    ],
    ...overrides,
  };
}

function presentation(state = mainState(), threadKey = "main") {
  const messages = [user("u1", 10), user("u2", 11), mainResponse()];
  return resolveThreadResponses(
    buildFeedSections(buildFeedModel(messages, false, 0, [], null, [], true).turns, 30),
    state,
    threadKey,
  );
}

describe("pending-batch response placement compatibility", () => {
  it("supports Main, places a grouped response after the final prompt, and deduplicates Quiz", () => {
    const result = presentation();

    expect(result?.currentResponses[0]?.anchorUserMessageId).toBe("u2");
    expect(result?.currentResponses[0]?.collapsedMessageEntry.msg.content).toBe("Main response");
    expect(result?.quizQuestIds).toEqual(["q-8"]);
  });

  it("fails closed for inconsistent pending totals or current history identity", () => {
    expect(
      presentation({
        ...mainState(),
        pendingMessageCount: 1,
        pendingBatches: [],
        ready: false,
      }),
    ).toBeNull();
    expect(
      presentation({
        ...mainState(),
        currentResponses: [{ ...mainState().currentResponses[0]!, currentHistoryIndex: 13 }],
      }),
    ).toBeNull();
  });

  it("never applies a per-thread response projection to All Threads", () => {
    expect(presentation(mainState(), "all")).toBeNull();
  });
});
