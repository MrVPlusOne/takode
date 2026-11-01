import { afterEach, describe, expect, it } from "vitest";
import { setTopicViewSource } from "../topic-views.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import {
  buildThreadRoutingReminderForCompletedTurn,
  leaderAssistantControlMetadata,
  normalizeLeaderAssistantRouting,
  splitLeaderAssistantContentAtThreadRouteBoundaries,
} from "./thread-routing-reminder.js";

function semanticRejectedAnswer(): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id: "semantic-rejection",
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: "Retained answer prose." }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    timestamp: 20,
    threadKey: "q-2044",
    questId: "q-2044",
    threadRefs: [{ threadKey: "q-2044", questId: "q-2044", source: "explicit" }],
    leaderThreadRole: "answer",
    threadRoutingError: {
      reason: "invalid_answer_route",
      source: "answer_marker",
      expected: "Use valid earlier user-message references with proven current owners.",
      answerRouteDiagnostic: {
        reason: "unproven_owner",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u37"],
        ownerGroups: [],
      },
    },
  };
}

describe("semantic answer-route reminder ownership", () => {
  it("leaves semantic rejection delivery to the outcome validator", () => {
    const answer = semanticRejectedAnswer();
    const session = {
      messageHistory: [answer],
      userMessageIdsThisTurn: [],
      messageCountAtTurnStart: 0,
    };

    expect(buildThreadRoutingReminderForCompletedTurn(session)).toBeNull();
  });
});

describe("leader answer marker routing", () => {
  it("carries an answer that names no messages to settlement with an empty ID list", () => {
    // Both backends route live leader text through these two steps. A bare
    // [thread:q-N:A] must reach turn settlement as an answer with an explicit empty
    // list, not as an answer missing its IDs (which settlement would reject).
    const routed = normalizeLeaderAssistantRouting(
      true,
      [{ type: "text", text: "[thread:q-7:A]\nToday's briefing." }],
      null,
    );
    expect(routed).toMatchObject({
      threadKey: "q-7",
      leaderThreadRole: "answer",
      leaderAnswerUserMessageIds: [],
      content: [{ type: "text", text: "Today's briefing." }],
    });
    expect(routed.threadRoutingError).toBeUndefined();
    const session = { messageHistory: [] as BrowserIncomingMessage[], messageCountAtTurnStart: 0 };
    expect(leaderAssistantControlMetadata(session, routed, true)).toEqual({
      leaderThreadRole: "answer",
      leaderAnswerUserMessageIds: [],
      leaderAnswerObservedHistoryLength: 0,
    });
    // Commentary still carries no answer IDs.
    const commentary = normalizeLeaderAssistantRouting(
      true,
      [{ type: "text", text: "[thread:q-7:C] Progress." }],
      null,
    );
    expect(leaderAssistantControlMetadata(session, commentary, true)).toEqual({ leaderThreadRole: "commentary" });
  });

  it("carries an urgent answer mark to settlement, including after a mid-message route switch", () => {
    // `A!` reaches turn settlement as leaderAnswerUrgent; the split that starts a
    // second routed section re-formats its marker and must keep the mark.
    const segments = splitLeaderAssistantContentAtThreadRouteBoundaries(
      true,
      [{ type: "text", text: "[thread:main:C] Checked mail.\n---\n[thread:q-7:A!:u2] Encore replied." }],
      null,
    );
    expect(segments).toHaveLength(2);
    const routed = normalizeLeaderAssistantRouting(true, segments[1]!, null);
    expect(routed).toMatchObject({
      threadKey: "q-7",
      leaderThreadRole: "answer",
      leaderAnswerUserMessageIds: ["u2"],
      leaderAnswerUrgent: true,
      content: [{ type: "text", text: "Encore replied." }],
    });
    const session = { messageHistory: [] as BrowserIncomingMessage[], messageCountAtTurnStart: 0 };
    expect(leaderAssistantControlMetadata(session, routed, true)).toEqual({
      leaderThreadRole: "answer",
      leaderAnswerUserMessageIds: ["u2"],
      leaderAnswerUrgent: true,
      leaderAnswerObservedHistoryLength: 0,
    });
    // A plain answer carries no mark.
    const plain = normalizeLeaderAssistantRouting(true, [{ type: "text", text: "[thread:q-7:A:u2] Done." }], null);
    expect(plain.leaderAnswerUrgent).toBeUndefined();
  });
});

describe("leader output to a topic thread no topic has", () => {
  afterEach(() => setTopicViewSource(null));

  function turn(threadKey: string) {
    const answer = semanticRejectedAnswer();
    delete answer.threadRoutingError;
    return {
      messageHistory: [
        { type: "user_message", id: "u", content: "hi", timestamp: 1, threadKey: "topic:6fd2c4bb" },
        { ...answer, threadKey, questId: undefined, threadRefs: [{ threadKey, source: "explicit" }] },
      ] as BrowserIncomingMessage[],
      userMessageIdsThisTurn: [0],
      messageCountAtTurnStart: 0,
    };
  }

  it("warns the leader, naming the unknown key and the closest threads", () => {
    // A mistyped handle sends output to a thread no view shows (only All). Instructions over
    // enforcement: the output is kept, and the leader is told where it went and what it may have meant.
    setTopicViewSource({
      topicOf: (handle) => (handle === "6fd2c4bb" ? { id: "6fd2c4bb-0000", name: "Relay testing", thread: {} } : null),
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
      listThreads: () => [{ id: "6fd2c4bb-0000", name: "Relay testing" }],
    });
    const reminder = buildThreadRoutingReminderForCompletedTurn(turn("topic:6fd2c4bc"));
    expect(reminder?.content).toContain("Unknown thread `topic:6fd2c4bc`");
    expect(reminder?.content).toContain('`topic:6fd2c4bb` "Relay testing"');
    expect(reminder?.route.threadKey).toBe("topic:6fd2c4bb");
    expect(buildThreadRoutingReminderForCompletedTurn(turn("topic:6fd2c4bb"))).toBeNull();
  });
});

describe("leader answers left in Main", () => {
  // Main is only the leader's log; the user's Home lists threads. An answer or new result left in
  // Main gets a reminder (the answer is kept); answers routed to the threads that own their
  // requests, and commentary, don't.
  function turn(answer: { threadKey: string; role: "answer" | "commentary"; ids?: string[] }, requestThread = "main") {
    const reply = semanticRejectedAnswer();
    delete reply.threadRoutingError;
    return {
      messageHistory: [
        {
          type: "user_message",
          id: "user-1",
          content: "Is the eval stalled?",
          timestamp: 1,
          leaderResponseCoverageVersion: 1,
          leaderUserMessageId: "u1",
          threadKey: requestThread,
          ...(requestThread.startsWith("q-") ? { questId: requestThread } : {}),
        },
        {
          ...reply,
          threadKey: answer.threadKey,
          questId: undefined,
          threadRefs: undefined,
          leaderThreadRole: answer.role,
          ...(answer.ids ? { leaderAnswerUserMessageIds: answer.ids } : {}),
        },
      ] as BrowserIncomingMessage[],
      userMessageIdsThisTurn: [0],
      messageCountAtTurnStart: 0,
    };
  }

  it("reminds the leader about a new result or an answer to a Main request left in Main", () => {
    const result = buildThreadRoutingReminderForCompletedTurn(turn({ threadKey: "main", role: "answer" }));
    expect(result?.content).toContain("You posted a new result in Main");
    expect(result?.content).toContain("takode thread new");
    const request = buildThreadRoutingReminderForCompletedTurn(
      turn({ threadKey: "main", role: "answer", ids: ["u1"] }),
    );
    expect(request?.content).toContain("You answered a request in Main");
    expect(request?.content).toContain("takode thread handoff");
  });

  it("stays quiet for commentary in Main, answers in a thread, and answers routed to a quest's request", () => {
    expect(buildThreadRoutingReminderForCompletedTurn(turn({ threadKey: "main", role: "commentary" }))).toBeNull();
    expect(
      buildThreadRoutingReminderForCompletedTurn(turn({ threadKey: "q-7", role: "answer", ids: ["u1"] }, "q-7")),
    ).toBeNull();
    // Written with a Main marker, but the request is q-7's: the answer goes to q-7 by itself.
    expect(
      buildThreadRoutingReminderForCompletedTurn(turn({ threadKey: "main", role: "answer", ids: ["u1"] }, "q-7")),
    ).toBeNull();
  });
});
