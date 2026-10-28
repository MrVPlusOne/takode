import { describe, expect, it } from "vitest";
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
