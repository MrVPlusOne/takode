import { describe, expect, it } from "vitest";
import { handoffThreadRef } from "./leader-thread-handoff.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { findSupportingQuestAnswer, findSupportingQuestSource, indexLeaderRequests } from "./supporting-quest.js";

// Producer-shaped leader history rows: a human request with its persisted uN,
// herd events and timer firings (which start leader turns), and settled answers.
function request(id: string, userMessageId: string, timestamp: number, threadKey: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: "Please compare the two runs.",
    timestamp,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: userMessageId,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
  } as BrowserIncomingMessage;
}

function herdEvent(timestamp: number, threadKey: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: `herd-${timestamp}`,
    content: "1 event from 1 session",
    timestamp,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    threadKey,
    questId: threadKey,
  } as BrowserIncomingMessage;
}

function answer(messageId: string, timestamp: number, threadKey: string, ids: string[]): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: `Answer ${messageId}` }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    timestamp,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    leaderThreadRole: "answer",
    threadAnswer: {
      version: 2,
      answerUserMessageIds: ids,
      observedHistoryLength: 0,
      authoredThreadKey: threadKey,
    },
  } as BrowserIncomingMessage;
}

const startedFrom = {
  sessionId: "leader",
  messageId: "ask",
  threadKey: "q-10",
  timestamp: 1000,
};

describe("findSupportingQuestSource", () => {
  it("finds the request a quest was filed from while that request stays in another thread", () => {
    const history = [request("ask", "u7", 1000, "q-10")];
    expect(findSupportingQuestSource(indexLeaderRequests(history), "leader", "q-11", startedFrom)).toEqual({
      threadKey: "q-10",
      userMessageId: "u7",
      historyIndex: 0,
    });
  });

  it("does not treat a quest the request was moved into as supporting", () => {
    // A Main request handed off to its quest makes the quest the conversation.
    const moved = request("ask", "u7", 1000, "main");
    (moved as { threadRefs?: unknown[] }).threadRefs = [handoffThreadRef("q-11", 2000, "leader")];
    expect(
      findSupportingQuestSource(indexLeaderRequests([moved]), "leader", "q-11", { ...startedFrom, threadKey: "main" }),
    ).toBeNull();
  });

  it("does not apply to quests filed in another leader's conversation or from unknown messages", () => {
    const history = [request("ask", "u7", 1000, "q-10")];
    expect(findSupportingQuestSource(indexLeaderRequests(history), "other-leader", "q-11", startedFrom)).toBeNull();
    expect(
      findSupportingQuestSource(indexLeaderRequests(history), "leader", "q-11", { ...startedFrom, messageId: "gone" }),
    ).toBeNull();
    expect(findSupportingQuestSource(indexLeaderRequests(history), "leader", "q-11", undefined)).toBeNull();
  });
});

describe("findSupportingQuestAnswer", () => {
  const source = { threadKey: "q-10", userMessageId: "u7", historyIndex: 0 };

  it("returns the latest answer written in a later turn, skipping the filing turn's answer", () => {
    // The quest is filed at 1500 in the turn the request started; "Filed it" in that
    // turn came before any result. The worker's herd event starts the turn that answers.
    const history = [
      request("ask", "u7", 1000, "q-10"),
      answer("filed", 1600, "q-10", ["u7"]),
      herdEvent(5000, "q-11"),
      answer("interim", 5100, "q-10", ["u7"]),
      herdEvent(9000, "q-11"),
      answer("final", 9100, "q-10", ["u7"]),
    ];
    // A routing marker that survived in stored text is not part of the answer.
    (history[5] as { message: { content: Array<{ text: string }> } }).message.content[0]!.text =
      "[thread:q-10:A:u7]\nAnswer final";
    expect(findSupportingQuestAnswer(history, source, "q-11", 1500)).toEqual({
      messageId: "final",
      threadKey: "q-10",
      timestamp: 9100,
      markdown: "Answer final",
    });
  });

  it("ignores answers to other requests and answers written in the quest's own thread", () => {
    const history = [
      request("ask", "u7", 1000, "q-10"),
      herdEvent(5000, "q-11"),
      answer("other-request", 5100, "q-10", ["u8"]),
      answer("in-quest-tab", 5200, "q-11", ["u7"]),
    ];
    expect(findSupportingQuestAnswer(history, source, "q-11", 1500)).toBeNull();
  });
});
