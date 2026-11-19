import { describe, expect, it } from "vitest";
import { handoffThreadRef } from "./leader-thread-handoff.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { QuestSourceIndex, questSources } from "./quest-source-index.js";
import {
  findSideQuestAnswer,
  findSideQuestSource,
  indexLeaderRequests,
  owedSideQuests,
  sideQuestEndedBy,
  sideQuestNoteFor,
  sideQuestOf,
  sideQuestSourceThreads,
} from "./side-quest.js";

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

describe("findSideQuestSource", () => {
  it("finds the request a quest was filed from while that request stays in another thread", () => {
    const history = [request("ask", "u7", 1000, "q-10")];
    expect(findSideQuestSource(indexLeaderRequests(history), "leader", "q-11", startedFrom)).toEqual({
      threadKey: "q-10",
      userMessageId: "u7",
      historyIndex: 0,
      timestamp: 1000,
    });
  });

  it("does not treat a quest the request was moved into as a side quest", () => {
    // A Main request handed off to its quest makes the quest the conversation.
    const moved = request("ask", "u7", 1000, "main");
    (moved as { threadRefs?: unknown[] }).threadRefs = [handoffThreadRef("q-11", 2000, "leader")];
    expect(
      findSideQuestSource(indexLeaderRequests([moved]), "leader", "q-11", { ...startedFrom, threadKey: "main" }),
    ).toBeNull();
  });

  it("treats a side quest the user wrote in as an ordinary quest", () => {
    // The user only writes in a side quest's tab to talk about it there, which makes it a
    // full quest: its completion is unread and it loses the side-quest mark.
    const history = [request("ask", "u7", 1000, "q-10"), request("follow-up", "u8", 3000, "q-11")];
    expect(findSideQuestSource(indexLeaderRequests(history), "leader", "q-11", startedFrom)).toBeNull();
    // So does her answer to a question the leader asked in the tab.
    const answer = { ...request("reply", "u9", 3500, "q-11"), replyContext: { notificationId: "n-4" } };
    const answered = [request("ask", "u7", 1000, "q-10"), answer as BrowserIncomingMessage];
    expect(findSideQuestSource(indexLeaderRequests(answered), "leader", "q-11", startedFrom)).toBeNull();
    // A worker's herd event in the tab does not count.
    const quiet = [request("ask", "u7", 1000, "q-10"), herdEvent(3000, "q-11")];
    expect(findSideQuestSource(indexLeaderRequests(quiet), "leader", "q-11", startedFrom)).not.toBeNull();
  });

  it("treats a side quest the leader answered or reported in as an ordinary quest", () => {
    // A result posted in the quest's own tab is something to read there, so the tab must
    // not be marked as one to skip. An answer naming no message (a new result) counts too.
    const ask = request("ask", "u7", 1000, "q-10");
    const newResult = answer("result", 5000, "q-11", []);
    expect(findSideQuestSource(indexLeaderRequests([ask, newResult]), "leader", "q-11", startedFrom)).toBeNull();
    const report = {
      type: "markdown_report",
      id: "report-1",
      timestamp: 5000,
      content: "# Findings",
      threadKey: "q-11",
      questId: "q-11",
      source: { sessionId: "leader", reportId: "report-1", sourcePath: "/tmp/report.md", sha256: "0" },
    } as BrowserIncomingMessage;
    expect(findSideQuestSource(indexLeaderRequests([ask, report]), "leader", "q-11", startedFrom)).toBeNull();
    // Commentary in the tab (dispatch notes, progress) keeps it a side quest.
    const commentary = { ...answer("progress", 5000, "q-11", []), leaderThreadRole: "commentary" } as Record<
      string,
      unknown
    >;
    delete commentary.threadAnswer;
    const quiet = [ask, commentary as BrowserIncomingMessage];
    expect(findSideQuestSource(indexLeaderRequests(quiet), "leader", "q-11", startedFrom)).not.toBeNull();
    // An answer the leader wrote where the request was asked is the expected place: still a side quest.
    const answeredWhereAsked = [ask, answer("final", 5000, "q-10", ["u7"])];
    expect(findSideQuestSource(indexLeaderRequests(answeredWhereAsked), "leader", "q-11", startedFrom)).not.toBeNull();
  });

  it("does not treat a quest filed as its own conversation as a side quest", () => {
    // `--own-thread`: one of several quests from a message, or long work. Its results go in its thread.
    const history = [request("ask", "u7", 1000, "q-10")];
    expect(
      findSideQuestSource(indexLeaderRequests(history), "leader", "q-11", { ...startedFrom, ownThread: true }),
    ).toBeNull();
  });

  it("does not apply to quests filed in another leader's conversation or from unknown messages", () => {
    const history = [request("ask", "u7", 1000, "q-10")];
    expect(findSideQuestSource(indexLeaderRequests(history), "other-leader", "q-11", startedFrom)).toBeNull();
    expect(
      findSideQuestSource(indexLeaderRequests(history), "leader", "q-11", { ...startedFrom, messageId: "gone" }),
    ).toBeNull();
    expect(findSideQuestSource(indexLeaderRequests(history), "leader", "q-11", undefined)).toBeNull();
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
    // Marking it its own conversation changes what its tab is, so that is a change too.
    const ownThread = { ...startedFrom, messageId: "other", ownThread: true };
    expect(index.record([{ ...quest, relationships: { startedFrom: ownThread } }])).toBe(true);
  });
});

describe("findSideQuestAnswer", () => {
  const source = { threadKey: "q-10", userMessageId: "u7", historyIndex: 0, timestamp: 1000 };

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
    expect(findSideQuestAnswer(history, source, "q-11", 1500)).toEqual({
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
    expect(findSideQuestAnswer(history, source, "q-11", 1500)).toBeNull();
  });
});

// These read the quest sources Takode keeps in memory, as the server does once quests are recorded.
describe("side quests seen from the leader's threads", () => {
  questSources.record([
    { questId: "q-11", relationships: { startedFrom } },
    { questId: "q-12", relationships: { startedFrom: { ...startedFrom, ownThread: true } } },
    { questId: "q-13", relationships: { startedFrom: { ...startedFrom, messageId: "main-ask", threadKey: "main" } } },
  ]);

  it("names the asking thread of a side quest, but not of its own conversation or a side quest of Main", () => {
    const history = [request("ask", "u7", 1000, "q-10"), request("main-ask", "u8", 1100, "main")];
    expect(sideQuestOf(history, "leader", "q-11")).toMatchObject({ threadKey: "q-10", userMessageId: "u7" });
    expect(sideQuestOf(history, "leader", "q-12")).toBeNull();
    // Main is the leader's log and takes no answers, so its old side quests are left as they are.
    expect(sideQuestOf(history, "leader", "q-13")).toBeNull();
    expect(sideQuestOf(history, "other-leader", "q-11")).toBeNull();
    expect(sideQuestOf(history, "leader", "q-10")).toBeNull();
  });

  it("owes the asking thread a side quest's result until an answer to its request comes after filing", () => {
    // q-11 was put on the board at 1500, in the turn the request started; "Filed it" doesn't count.
    const board = [{ questId: "q-11", createdAt: 1500 }];
    const filed = [request("ask", "u7", 1000, "q-10"), answer("filed", 1600, "q-10", ["u7"])];
    expect(owedSideQuests(filed, "leader", "q-10", board)).toMatchObject([{ questId: "q-11" }]);
    // Another thread doesn't wait for it, and a quest filed as its own conversation is owed nowhere.
    expect(owedSideQuests(filed, "leader", "q-20", board)).toEqual([]);
    expect(owedSideQuests(filed, "leader", "q-10", [{ questId: "q-12", createdAt: 1500 }])).toEqual([]);
    // The result posted in a later turn settles it.
    const answered = [...filed, herdEvent(5000, "q-11"), answer("result", 5100, "q-10", ["u7"])];
    expect(owedSideQuests(answered, "leader", "q-10", board)).toEqual([]);
  });

  it("says when the user's message ends a side quest, only for the message that ends it", () => {
    const ask = request("ask", "u7", 1000, "q-10");
    const first = request("in-tab", "u8", 3000, "q-11") as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    expect(sideQuestEndedBy([ask, first], "leader", first)).toMatchObject({
      questId: "q-11",
      source: { threadKey: "q-10", userMessageId: "u7" },
    });
    // Once it is ordinary, later messages in its tab change nothing.
    const second = request("again", "u9", 4000, "q-11") as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    expect(sideQuestEndedBy([ask, first, second], "leader", second)).toBeNull();
    // A message in the asking thread ends nothing.
    const elsewhere = request("there", "u10", 4000, "q-10") as Extract<
      BrowserIncomingMessage,
      { type: "user_message" }
    >;
    expect(sideQuestEndedBy([ask, elsewhere], "leader", elsewhere)).toBeNull();
  });

  it("tells the leader where the result goes, and whether it went there", () => {
    const filed = [request("ask", "u7", 1000, "q-10"), answer("filed", 1600, "q-10", ["u7"])];
    expect(sideQuestNoteFor(filed, "leader", "q-11", 1500)).toContain("post it in q-10 as an answer to u7");
    const answered = [...filed, herdEvent(5000, "q-11"), answer("result", 5100, "q-10", ["u7"])];
    expect(sideQuestNoteFor(answered, "leader", "q-11", 1500)).toContain("you posted its result there");
    // Off the board the request's time stands in, so the filing turn's answer still doesn't count.
    expect(sideQuestNoteFor(filed, "leader", "q-11", undefined)).toContain("post it in q-10");
    expect(sideQuestNoteFor(filed, "leader", "q-12", 1500)).toBeNull();
  });
});
