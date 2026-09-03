import { describe, expect, it } from "vitest";
import { buildFeedModel } from "../hooks/use-feed-model.js";
import type { ChatMessage, LeaderThreadResponseProjection } from "../types.js";
import { buildFeedSections } from "../components/message-feed-sections.js";
import { resolveThreadResponses } from "../components/thread-response-presentation.js";

function user(answerId: string, historyIndex: number): ChatMessage {
  return {
    id: `raw-${answerId}`,
    role: "user",
    content: answerId,
    timestamp: historyIndex,
    historyIndex,
    metadata: { threadKey: "main", leaderResponseCoverageVersion: 1, leaderUserMessageId: answerId },
  };
}

function mainAnswer(): ChatMessage {
  return {
    id: "main-answer",
    role: "assistant",
    content: "Main answer\n\n{[(Quest Quiz: q-8)]}\n{[(Quest Quiz: q-8)]}",
    timestamp: 12,
    historyIndex: 12,
    metadata: {
      leaderThreadRole: "answer",
      threadKey: "main",
      threadAnswer: { version: 2, answerUserMessageIds: ["u1", "u2"], observedHistoryLength: 12 },
    },
  };
}

function mainState(overrides: Partial<LeaderThreadResponseProjection> = {}): LeaderThreadResponseProjection {
  return {
    version: 2,
    threadKey: "main",
    cutoverHistoryIndex: 10,
    pendingMessageCount: 0,
    pendingMessages: [],
    ready: true,
    currentAnswers: [
      {
        version: 2,
        threadKey: "main",
        answerUserMessageIds: ["u1", "u2"],
        referencedUserMessageIds: ["raw-u1", "raw-u2"],
        coveredAnswerUserMessageIds: ["u1", "u2"],
        coveredUserMessageIds: ["raw-u1", "raw-u2"],
        currentMessageId: "main-answer",
        currentHistoryIndex: 12,
        createdAt: 12,
        updatedAt: 12,
        source: "explicit",
      },
    ],
    ...overrides,
  };
}

function presentation(state = mainState(), threadKey = "main") {
  const messages = [user("u1", 10), user("u2", 11), mainAnswer()];
  return resolveThreadResponses(
    buildFeedSections(buildFeedModel(messages, false, 0, [], null, [], true).turns, 30),
    state,
    threadKey,
  );
}

describe("explicit answer placement compatibility", () => {
  it("supports Main, places a grouped answer after the final prompt, and deduplicates Quiz", () => {
    const result = presentation();

    expect(result?.currentResponses[0]?.anchorUserMessageId).toBe("raw-u2");
    expect(result?.currentResponses[0]?.collapsedMessageEntry.msg.content).toBe("Main answer");
    expect(result?.quizGroups).toEqual([{ hostTurnId: "raw-u2", questIds: ["q-8"] }]);
  });

  it("fails closed for inconsistent pending totals or current history identity", () => {
    expect(
      presentation({
        ...mainState(),
        pendingMessageCount: 1,
        pendingMessages: [],
        ready: false,
      }),
    ).toBeNull();
    expect(
      presentation({
        ...mainState(),
        currentAnswers: [{ ...mainState().currentAnswers[0]!, currentHistoryIndex: 13 }],
      }),
    ).toBeNull();
  });

  it("never applies a per-thread answer projection to All Threads", () => {
    expect(presentation(mainState(), "all")).toBeNull();
  });
});
