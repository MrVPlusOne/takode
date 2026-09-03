import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { buildLeaderThreadResponseState, finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import {
  clearLeaderThreadStatusForCoveredUserMessage,
  leaderTurnObservedHistoryLength,
  updateLeaderThreadStatusesForAssistantOutput,
} from "./thread-routing-reminder.js";

function human(): Extract<BrowserIncomingMessage, { type: "user_message" }> {
  return {
    type: "user_message",
    id: "raw-u1",
    leaderUserMessageId: "u1",
    content: "Please finish this.",
    timestamp: 10,
    threadKey: "q-42",
    questId: "q-42",
    threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    leaderResponseCoverageVersion: 1,
  };
}

function finalResponse(): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id: "final-response",
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 30,
    threadKey: "q-42",
    questId: "q-42",
    threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    leaderThreadRole: "answer",
    leaderAnswerUserMessageIds: ["u1"],
    leaderAnswerObservedHistoryLength: 1,
  };
}

function marker(kind: "waiting" | "ready") {
  return {
    kind,
    label: kind === "ready" ? ("Thread Ready" as const) : ("Thread Waiting" as const),
    target: { threadKey: "q-42", questId: "q-42" },
    summary: kind === "ready" ? "complete" : "review running",
    raw: `{[(Thread ${kind === "ready" ? "Ready" : "Waiting"}: q-42 | status)]}`,
    lineIndex: 0,
  };
}

function oldReady(): LeaderThreadStatus {
  return {
    kind: "ready",
    label: "Thread Ready",
    threadKey: "q-42",
    questId: "q-42",
    summary: "previous request complete",
    messageId: "old-ready",
    timestamp: 1,
    updatedAt: 1,
  };
}

describe("Thread Ready answer coverage gate", () => {
  it("uses the active turn owner boundary for asynchronous completions without absorbing later queued input", () => {
    const history = [
      human(),
      {
        type: "user_message" as const,
        id: "herd-event",
        content: "Worker finished",
        timestamp: 20,
        threadKey: "q-42",
        agentSource: { sessionId: "worker", sessionLabel: "Worker" },
      },
      { ...human(), id: "later-user", timestamp: 30, content: "One more request" },
    ] as BrowserIncomingMessage[];

    expect(
      leaderTurnObservedHistoryLength({
        messageHistory: history,
        userMessageIdsThisTurn: [1],
        // A promoted queued turn may start after later rows already reached the
        // history tail, so current-turn ownership is more exact than tail size.
        messageCountAtTurnStart: 3,
      }),
    ).toBe(2);
    expect(
      leaderTurnObservedHistoryLength({
        messageHistory: history,
        userMessageIdsThisTurn: [],
        messageCountAtTurnStart: 2,
      }),
    ).toBe(2);
  });

  it("invalidates stale Ready state as soon as a covered direct-user message commits", () => {
    const message = human();
    const session = {
      id: "leader",
      messageHistory: [message],
      state: { leaderThreadStatuses: { "q-42": oldReady() } },
    };

    expect(clearLeaderThreadStatusForCoveredUserMessage(session, message)).toBe(true);
    expect(session.state.leaderThreadStatuses["q-42"]).toBeUndefined();
  });

  it("rejects Ready while pending and reports the rejected target even for a marker-only row", () => {
    const session = {
      id: "leader",
      messageHistory: [human()] as BrowserIncomingMessage[],
      state: { leaderThreadStatuses: { "q-42": oldReady() } },
    };

    const update = updateLeaderThreadStatusesForAssistantOutput(session, [marker("ready")], {
      messageId: "attempted-ready",
      timestamp: 20,
    });

    expect(update).toEqual({
      records: [],
      changed: true,
      rejectedReadyRoutes: [
        {
          threadKey: "q-42",
          questId: "q-42",
          threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
        },
      ],
    });
    expect(session.state.leaderThreadStatuses["q-42"]).toBeUndefined();
  });

  it("rejects Ready after restart while a later direct Codex input remains accepted but uncommitted", () => {
    // Persisted pending Codex input is authoritative work even before provider history commits it.
    const session = {
      id: "leader",
      messageHistory: [human()] as BrowserIncomingMessage[],
      pendingCodexInputs: [
        {
          id: "raw-u2",
          content: "A later queued request",
          timestamp: 40,
          cancelable: true,
          leaderResponseCoverageVersion: 1 as const,
          leaderUserMessageId: "u2",
          threadKey: "q-42",
          questId: "q-42",
          threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" as const }],
        },
      ],
      state: { leaderThreadStatuses: { "q-42": oldReady() } },
    };
    const response = finalResponse();
    session.messageHistory.push(response);
    expect(finalizeRoutedLeaderResponseMessage(session, response)).toMatchObject({ finalized: true });
    expect(buildLeaderThreadResponseState(session, "q-42").projection.ready).toBe(true);

    const update = updateLeaderThreadStatusesForAssistantOutput(session, [marker("ready")], {
      messageId: response.message.id,
      timestamp: response.timestamp!,
    });

    expect(update.records).toEqual([]);
    expect(update.rejectedReadyRoutes).toEqual([expect.objectContaining({ threadKey: "q-42" })]);
    expect(session.state.leaderThreadStatuses["q-42"]).toBeUndefined();
  });

  it("rejects Ready while a same-thread needs-input notification remains unresolved", () => {
    // Answer coverage does not override the separate scoped user-decision gate.
    const session = {
      id: "leader",
      messageHistory: [human()] as BrowserIncomingMessage[],
      notifications: [
        {
          id: "n-1",
          category: "needs-input" as const,
          summary: "Choose rollout",
          timestamp: 25,
          messageId: null,
          done: false,
          threadKey: "q-42",
          questId: "q-42",
        },
      ],
      state: { leaderThreadStatuses: {} as Record<string, LeaderThreadStatus> },
    };
    const response = finalResponse();
    session.messageHistory.push(response);
    expect(finalizeRoutedLeaderResponseMessage(session, response)).toMatchObject({ finalized: true });

    const update = updateLeaderThreadStatusesForAssistantOutput(session, [marker("ready")], {
      messageId: response.message.id,
      timestamp: response.timestamp!,
    });

    expect(update.records).toEqual([]);
    expect(update.rejectedReadyRoutes).toEqual([expect.objectContaining({ threadKey: "q-42" })]);
    expect(session.state.leaderThreadStatuses["q-42"]).toBeUndefined();
  });

  it("accepts Waiting while pending and Ready after the same routed answer is stamped", () => {
    const session = {
      id: "leader",
      messageHistory: [human()] as BrowserIncomingMessage[],
      state: { leaderThreadStatuses: {} as Record<string, LeaderThreadStatus> },
    };
    expect(
      updateLeaderThreadStatusesForAssistantOutput(session, [marker("waiting")], {
        messageId: "waiting",
        timestamp: 20,
      }).records,
    ).toEqual([expect.objectContaining({ kind: "waiting", threadKey: "q-42" })]);

    const response = finalResponse();
    session.messageHistory.push(response);
    expect(finalizeRoutedLeaderResponseMessage(session, response)).toMatchObject({ finalized: true });
    expect(buildLeaderThreadResponseState(session, "q-42").projection.ready).toBe(true);
    const ready = updateLeaderThreadStatusesForAssistantOutput(session, [marker("ready")], {
      messageId: response.message.id,
      timestamp: response.timestamp!,
    });

    expect(ready.records).toEqual([expect.objectContaining({ kind: "ready", threadKey: "q-42" })]);
    expect(ready.rejectedReadyRoutes).toBeUndefined();
    expect(session.state.leaderThreadStatuses["q-42"]?.kind).toBe("ready");
  });
});
