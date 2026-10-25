import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, LeaderThreadResponseProjection } from "../server/session-types.js";
import { buildFeedSections } from "../src/components/message-feed-sections.js";
import { resolveThreadResponses } from "../src/components/thread-response-presentation.js";
import { buildFeedModel } from "../src/hooks/use-feed-model.js";
import { normalizeHistoryMessageToChatMessages } from "../src/utils/history-message-normalization.js";
import { buildThreadWindowSync } from "./thread-window.js";
import { topicThreadKey } from "./topic-thread-key.js";

/**
 * A topic conversation shows answers as each quest's own tab does: its window carries every
 * member quest's answer state, bounded and proven as in that quest's window, and each quest's
 * answers resolve against the stitched feed into the same presentation (what they answer,
 * collapsed answer sets).
 */
function ref(threadKey: string) {
  return { threadKey, questId: threadKey, source: "explicit" as const };
}

function human(rawId: string, answerId: string, timestamp: number, threadKey: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: rawId,
    leaderUserMessageId: answerId,
    content: rawId,
    timestamp,
    leaderResponseCoverageVersion: 1,
    threadKey,
    questId: threadKey,
    threadRefs: [ref(threadKey)],
  };
}

function answer(id: string, timestamp: number, threadKey: string, answerIds: string[]): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: "answer",
    threadKey,
    questId: threadKey,
    threadRefs: [ref(threadKey)],
    threadAnswer: { version: 2 as const, answerUserMessageIds: answerIds, observedHistoryLength: timestamp },
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: `Answer ${id}` }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

/** A quest's settled answer state: one request, answered (as the server builds it from history). */
function answered(threadKey: string, raw: string, answerId: string, answerMessageId: string, index: number) {
  const projection: LeaderThreadResponseProjection = {
    version: 2,
    threadKey,
    cutoverHistoryIndex: 0,
    pendingMessageCount: 0,
    pendingMessages: [],
    currentAnswers: [
      {
        version: 2,
        threadKey,
        questId: threadKey,
        answerUserMessageIds: [answerId],
        referencedUserMessageIds: [raw],
        coveredAnswerUserMessageIds: [answerId],
        coveredUserMessageIds: [raw],
        currentMessageId: answerMessageId,
        currentHistoryIndex: index,
        createdAt: index + 1,
        updatedAt: index + 1,
        source: "explicit",
      },
    ],
    ready: true,
  };
  return projection;
}

describe("topic conversation answers", () => {
  it("carries each quest's answer state, and each resolves as in the quest's own tab", () => {
    const messages = [
      human("raw-u1", "u1", 1, "q-1"),
      answer("a1", 2, "q-1", ["u1"]),
      human("raw-u2", "u2", 3, "q-2"),
      answer("a2", 4, "q-2", ["u2"]),
    ];
    const topicKey = topicThreadKey(["q-1", "q-2"]);
    const sync = buildThreadWindowSync({
      messageHistory: messages,
      threadKey: topicKey,
      fromItem: -1,
      itemCount: 10,
      sectionItemCount: 10,
      visibleItemCount: 1,
      memberResponseProjection: (questId) =>
        ({
          "q-1": answered("q-1", "raw-u1", "u1", "a1", 1),
          "q-2": answered("q-2", "raw-u2", "u2", "a2", 3),
        })[questId],
    });

    // The topic's own state carries no answers, only each quest's.
    const state = sync.threadResponseProjection!;
    expect(state.threadKey).toBe(topicKey);
    expect(state.currentAnswers).toEqual([]);
    expect(Object.keys(state.members!)).toEqual(["q-1", "q-2"]);
    expect(state.members!["q-2"]!.currentAnswers.map((item) => item.currentMessageId)).toEqual(["a2"]);

    const chat = sync.entries.flatMap((entry) =>
      normalizeHistoryMessageToChatMessages(entry.message, entry.history_index),
    );
    const sections = buildFeedSections(buildFeedModel(chat, true, 0, undefined, undefined, undefined, true).turns, 30);
    for (const questId of ["q-1", "q-2"]) {
      const presentation = resolveThreadResponses(sections, state.members![questId], questId, true, chat);
      expect(presentation?.currentResponses).toHaveLength(1);
    }
  });

  it("asks only the quests with turns in the window for their answer state", () => {
    // Opening a topic of many quests was slow: every quest's answer state was built from the
    // whole history, and each quest's newest answer was pulled into the newest window even when
    // it sat far above it. A quest whose turns are not in the window must cost and add nothing.
    const messages = [
      human("raw-u1", "u1", 1, "q-1"),
      answer("a1", 2, "q-1", ["u1"]),
      human("raw-u2", "u2", 3, "q-2"),
      answer("a2", 4, "q-2", ["u2"]),
    ];
    const asked: string[] = [];
    const sync = buildThreadWindowSync({
      messageHistory: messages,
      threadKey: topicThreadKey(["q-1", "q-2"]),
      fromItem: -1,
      // Only the newest turn (q-2's) is in the window.
      itemCount: 1,
      sectionItemCount: 1,
      visibleItemCount: 1,
      memberResponseProjection: (questId) => {
        asked.push(questId);
        const n = questId.slice(2);
        return answered(questId, `raw-u${n}`, `u${n}`, `a${n}`, n === "1" ? 1 : 3);
      },
    });

    expect(asked).toEqual(["q-2"]);
    expect(Object.keys(sync.threadResponseProjection!.members!)).toEqual(["q-2"]);
    expect(sync.entries.map((entry) => entry.history_index)).toEqual([2, 3]);
  });
});
