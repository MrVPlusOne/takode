import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionNotification } from "../session-types.js";
import { buildLeaderThreadResponseState, finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";
import { notifyUser } from "./session-notification-controller.js";
import { THREAD_OUTCOME_REMINDER_SOURCE_ID } from "../../shared/thread-outcome-reminder.js";

// A needs-input prompt's context is written to history as an ordinary root
// assistant message. These tests exercise the leader path end to end through the
// real answer settlement, because the design relies on that settlement (not a
// new authority) to decide whether the context answers the named request.

function directRequest(): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: "raw-u1",
    leaderUserMessageId: "u1",
    content: "Give me a proposal to unblock the run.",
    timestamp: 10,
    threadKey: "q-42",
    questId: "q-42",
    threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    leaderResponseCoverageVersion: 1,
  };
}

function notifyTool(): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id: "notify-call",
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "takode notify needs-input" } }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 20,
    threadKey: "q-42",
    questId: "q-42",
  };
}

function leaderSession() {
  return {
    id: "leader",
    messageHistory: [directRequest(), notifyTool()] as BrowserIncomingMessage[],
    userMessageIdsThisTurn: [0],
    notifications: [] as SessionNotification[],
    notificationCounter: 0,
    activeTurnRoute: { threadKey: "q-42", questId: "q-42" },
    state: { model: "test" },
    pendingPermissions: new Map(),
    attentionReason: null,
  };
}

function notifyWithContext(session: ReturnType<typeof leaderSession>, answerUserMessageIds?: string[]) {
  return notifyUser(
    session,
    "needs-input",
    "Approve skipping the three containers?",
    { getLauncherSessionInfo: () => ({ isOrchestrator: true }), persistSession: vi.fn() },
    {
      context: "Skipping them costs 0.002% of the data.",
      ...(answerUserMessageIds ? { answerUserMessageIds } : {}),
      questions: [{ prompt: "Resume without them?", suggestedAnswers: ["yes", "no"] }],
    },
  );
}

function contextMessage(session: ReturnType<typeof leaderSession>) {
  const entry = session.messageHistory.at(-1);
  if (entry?.type !== "assistant") throw new Error("expected the context message last");
  return entry;
}

describe("needs-input context as a leader answer", () => {
  it("covers the named request through normal turn-end answer settlement", () => {
    const session = leaderSession();
    const result = notifyWithContext(session, ["u1"]);

    expect(result.anchoredMessageId).toBe("needs-input-context-n-1");
    expect(finalizeRoutedLeaderResponseMessage(session, contextMessage(session))).toEqual({
      finalized: true,
      answerId: "needs-input-context-n-1",
    });
    const { projection } = buildLeaderThreadResponseState(session, "q-42");
    expect(projection.pendingMessageCount).toBe(0);
    expect(projection.currentAnswers[0]).toMatchObject({
      currentMessageId: "needs-input-context-n-1",
      coveredAnswerUserMessageIds: ["u1"],
    });
  });

  it("leaves the request pending when the context names no answered message", () => {
    const session = leaderSession();
    notifyWithContext(session);

    expect(contextMessage(session).leaderThreadRole).toBe("commentary");
    expect(buildLeaderThreadResponseState(session, "q-42").projection.pendingMessages).toMatchObject([
      { userMessageId: "u1" },
    ]);
  });

  it("rejects a named message that is not a supplied earlier request", () => {
    // The same proof as a `[thread:q-42:A:u2]` row applies: an unknown ID cannot
    // gain coverage and leaves the real request pending with a diagnostic.
    const session = leaderSession();
    notifyWithContext(session, ["u2"]);

    expect(finalizeRoutedLeaderResponseMessage(session, contextMessage(session))).toMatchObject({ finalized: false });
    expect(contextMessage(session).threadRoutingError?.reason).toBe("invalid_answer_route");
    expect(buildLeaderThreadResponseState(session, "q-42").projection.pendingMessageCount).toBe(1);
  });

  it("still satisfies an outcome reminder that preceded the new context message", () => {
    // The reminder asked for a fresh prompt; the context is written after it, so
    // satisfaction must look from the earlier decision source, not the new anchor.
    const session = leaderSession();
    session.messageHistory.push({
      type: "user_message",
      id: "outcome-reminder",
      content: "Thread outcome reminder",
      timestamp: Date.now() - 1,
      threadKey: "q-42",
      questId: "q-42",
      agentSource: { sessionId: THREAD_OUTCOME_REMINDER_SOURCE_ID, sessionLabel: "Thread Outcome Reminder" },
    } as BrowserIncomingMessage);
    notifyWithContext(session, ["u1"]);

    expect(
      (session.messageHistory[2] as { threadOutcomeReminder?: { status: string } }).threadOutcomeReminder,
    ).toMatchObject({
      status: "satisfied",
      notificationId: "n-1",
    });
  });
});
