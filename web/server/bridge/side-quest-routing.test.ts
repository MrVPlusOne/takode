import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";
import { questSources } from "../quest-source-index.js";
import { findSideQuestSource, indexLeaderRequests } from "../side-quest.js";
import { updateLeaderThreadStatusesForAssistantOutput } from "./thread-routing-reminder.js";
import { validateLeaderThreadOutcomes } from "./leader-thread-outcome-validator.js";

// q-43 is a side quest filed from the user's request u1, asked in q-42's thread.
questSources.record([
  {
    questId: "q-43",
    relationships: { startedFrom: { sessionId: "leader", messageId: "raw-u1", threadKey: "q-42", timestamp: 10 } },
  },
]);

function request(): Extract<BrowserIncomingMessage, { type: "user_message" }> {
  return {
    type: "user_message",
    id: "raw-u1",
    leaderUserMessageId: "u1",
    content: "Is the run healthy, and could you also check the old branches?",
    timestamp: 10,
    threadKey: "q-42",
    questId: "q-42",
    threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    leaderResponseCoverageVersion: 1,
  };
}

/** A worker event, which starts a new leader turn in the side quest's thread. */
function herdEvent(timestamp: number): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: `herd-${timestamp}`,
    content: "1 event from 1 session",
    timestamp,
    threadKey: "q-43",
    questId: "q-43",
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
  };
}

/** A leader answer as the turn produced it, before Takode settles where it belongs. */
function answerIn(
  threadKey: string,
  id: string,
  timestamp: number,
  ids: string[],
  observed: number,
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: `Result ${id}: every branch is already merged.` }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    threadKey,
    questId: threadKey,
    threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
    leaderThreadRole: "answer",
    leaderAnswerUserMessageIds: ids,
    leaderAnswerObservedHistoryLength: observed,
  };
}

function readyMarker(threadKey: string) {
  return {
    kind: "ready" as const,
    label: "Thread Ready" as const,
    target: { threadKey, questId: threadKey },
    summary: "answered",
    raw: `{[(Thread Ready: ${threadKey} | answered)]}`,
    lineIndex: 0,
  };
}

describe("a leader's answer written in a side quest's thread", () => {
  it("goes to the thread where the user asked and leaves the side quest quiet", () => {
    // The worker finished, and the leader wrote the result in the side quest's tab, where
    // the worker's event arrived. The user reads it where they asked, and q-43 stays a side quest.
    const result = answerIn("q-43", "result", 5100, ["u1"], 2);
    const session = { id: "leader", messageHistory: [request(), herdEvent(5000), result] };

    expect(finalizeRoutedLeaderResponseMessage(session, result)).toEqual({ finalized: true, answerId: "result" });
    expect(result.threadAnswer?.authoredThreadKey).toBe("q-42");
    expect(result.threadKey).toBe("q-42");
    expect(
      findSideQuestSource(indexLeaderRequests(session.messageHistory), "leader", "q-43", questSources.get("q-43")),
    ).not.toBeNull();
  });

  it("moves a new result naming no message to the asking thread too", () => {
    const result = answerIn("q-43", "new-result", 5100, [], 2);
    const session = { id: "leader", messageHistory: [request(), herdEvent(5000), result] };

    expect(finalizeRoutedLeaderResponseMessage(session, result).finalized).toBe(true);
    expect(result.threadAnswer?.authoredThreadKey).toBe("q-42");
  });

  it("stays in an ordinary quest's thread once the user wrote there", () => {
    const userInTab = { ...request(), id: "raw-u2", leaderUserMessageId: "u2", threadKey: "q-43", questId: "q-43" };
    userInTab.threadRefs = [{ threadKey: "q-43", questId: "q-43", source: "explicit" }];
    const reply = answerIn("q-43", "reply", 5100, ["u2"], 2);
    const session = { id: "leader", messageHistory: [request(), userInTab, reply] };

    expect(finalizeRoutedLeaderResponseMessage(session, reply).finalized).toBe(true);
    expect(reply.threadAnswer?.authoredThreadKey).toBe("q-43");
  });
});

describe("Thread Ready while a side quest owes its result", () => {
  function leaderSession(history: BrowserIncomingMessage[]) {
    return {
      id: "leader",
      messageHistory: history,
      board: new Map([["q-43", { questId: "q-43", createdAt: 15 }]]),
      state: {} as {
        leaderThreadStatuses?: Record<string, import("../../shared/thread-status-marker.js").LeaderThreadStatus>;
      },
    };
  }

  it("refuses the asking thread's Ready, leaving its status to the leader, and says why", () => {
    // The leader answered the first part of u1 when filing q-43 (turn started at 10, quest on
    // the board at 15) and marked q-42 Ready: the side quest's part is still owed there. Takode
    // does not set a status the leader did not write (Jiayi, Nov 18): it refuses the Ready, and
    // the reminder at the end of the turn names the side quest and what to do.
    const partial = answerIn("q-42", "partial", 20, ["u1"], 1);
    const session = { ...leaderSession([request(), partial]), notifications: [] };
    finalizeRoutedLeaderResponseMessage(session, partial);

    const update = updateLeaderThreadStatusesForAssistantOutput(session, [readyMarker("q-42")], {
      messageId: "partial",
      timestamp: 20,
    });
    expect(update.rejectedReadyRoutes?.map((route) => route.threadKey)).toEqual(["q-42"]);
    expect(session.state.leaderThreadStatuses?.["q-42"]).toBeUndefined();

    const injectUserMessage = vi.fn((..._args: unknown[]) => "sent" as const);
    validateLeaderThreadOutcomes(
      session,
      { isLeaderSession: () => true, getTurnSource: () => "user", injectUserMessage },
      { rejectedReadyThreadKeys: ["q-42"] },
    );
    const reminder = String(injectUserMessage.mock.calls[0]?.[1]);
    expect(reminder).toContain("Missing outcome marker for: q-42.");
    expect(reminder).toContain("q-42 cannot be Ready yet: its side quest q-43 has not had its result posted there.");
    expect(reminder).toContain("{[(Thread Waiting: q-42 | waiting for q-43)]}");
    expect(reminder).toContain(
      "When its result exists, post it in q-42 as an answer to u1, even if you already answered part",
    );
  });

  it("lets the asking thread be Ready once the side quest's result was posted there", () => {
    const partial = answerIn("q-42", "partial", 20, ["u1"], 1);
    const result = answerIn("q-42", "result", 5100, ["u1"], 3);
    const session = leaderSession([request(), partial, herdEvent(5000), result]);
    finalizeRoutedLeaderResponseMessage(session, partial);
    finalizeRoutedLeaderResponseMessage(session, result);

    updateLeaderThreadStatusesForAssistantOutput(session, [readyMarker("q-42")], {
      messageId: "result",
      timestamp: 5100,
    });
    expect(session.state.leaderThreadStatuses?.["q-42"]).toMatchObject({ kind: "ready", summary: "answered" });
  });
});
