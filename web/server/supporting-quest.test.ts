import { describe, expect, it } from "vitest";
import { handoffThreadRef } from "./leader-thread-handoff.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { QuestSourceIndex } from "./quest-source-index.js";
import {
  findSupportingQuestAnswer,
  findSupportingQuestSource,
  indexLeaderRequests,
  sideQuestSourceThreads,
} from "./supporting-quest.js";

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

  it("treats a supporting quest the user wrote in as an ordinary quest", () => {
    // The user only writes in a side quest's tab to talk about it there, which makes it a
    // full quest: its completion is unread and it loses the side-quest mark.
    const history = [request("ask", "u7", 1000, "q-10"), request("follow-up", "u8", 3000, "q-11")];
    expect(findSupportingQuestSource(indexLeaderRequests(history), "leader", "q-11", startedFrom)).toBeNull();
    // A herd event, or an answer to a question the leader asked in the tab, does not count.
    const answer = { ...request("reply", "u9", 3500, "q-11"), replyContext: { notificationId: "n-4" } };
    const quiet = [request("ask", "u7", 1000, "q-10"), herdEvent(3000, "q-11"), answer as BrowserIncomingMessage];
    expect(findSupportingQuestSource(indexLeaderRequests(quiet), "leader", "q-11", startedFrom)).not.toBeNull();
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

describe("sideQuestSourceThreads", () => {
  it("maps each side quest to the thread that still owns its request, in one pass for many quests", () => {
    // q-11 and q-12 were filed from a request asked in q-10; q-13 from a Main request that
    // was then handed off to it, so q-13 is the conversation, not a side quest.
    const moved = request("main-ask", "u8", 1100, "main");
    (moved as { threadRefs?: unknown[] }).threadRefs = [handoffThreadRef("q-13", 2000, "leader")];
    // q-15 was filed from the same request as q-11, but the user has since written in its tab.
    const history = [request("ask", "u7", 1000, "q-10"), moved, request("in-q-15", "u9", 3000, "q-15")];
    const sources = new Map([
      ["q-11", startedFrom],
      ["q-12", startedFrom],
      ["q-13", { ...startedFrom, messageId: "main-ask", threadKey: "main" }],
      // Filed in another leader's conversation: not this leader's side quest.
      ["q-14", { ...startedFrom, sessionId: "other-leader" }],
      ["q-15", startedFrom],
    ]);
    expect(sideQuestSourceThreads(history, "leader", sources)).toEqual(
      new Map([
        ["q-11", "q-10"],
        ["q-12", "q-10"],
      ]),
    );
  });
});

describe("QuestSourceIndex", () => {
  it("reports a change only when a quest's source is new or different", () => {
    // The leader tabs are refreshed only on a change, so repeats must report none.
    const index = new QuestSourceIndex();
    const quest = { questId: "Q-11", relationships: { startedFrom } };
    expect(index.record([quest, { questId: "q-12", relationships: {} }])).toBe(true);
    expect(index.get("q-11")).toEqual(startedFrom);
    expect(index.get("q-12")).toBeUndefined();
    expect(index.record([quest])).toBe(false);
    expect(index.record([{ ...quest, relationships: { startedFrom: { ...startedFrom, messageId: "other" } } }])).toBe(
      true,
    );
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
