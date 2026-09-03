import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { buildLeaderThreadResponseState, publishLeaderThreadResponse } from "../leader-thread-response.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import {
  clearLeaderThreadStatusForCoveredUserMessage,
  updateLeaderThreadStatusesForAssistantOutput,
} from "./thread-routing-reminder.js";

function human(): Extract<BrowserIncomingMessage, { type: "user_message" }> {
  return {
    type: "user_message",
    id: "u1",
    content: "Please finish this.",
    timestamp: 10,
    threadKey: "q-42",
    questId: "q-42",
    threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    leaderResponseCoverageVersion: 1,
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

describe("Thread Ready response coverage gate", () => {
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

  it("rejects Ready while pending and removes any prior status even for a marker-only turn", () => {
    const session = {
      id: "leader",
      messageHistory: [human()] as BrowserIncomingMessage[],
      state: { leaderThreadStatuses: { "q-42": oldReady() } },
    };

    const update = updateLeaderThreadStatusesForAssistantOutput(session, [marker("ready")], {
      messageId: "attempted-ready",
      timestamp: 20,
    });

    expect(update).toEqual({ records: [], changed: true });
    expect(session.state.leaderThreadStatuses["q-42"]).toBeUndefined();
  });

  it("accepts Waiting while pending and Ready after the batch has a valid response", () => {
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

    const token = buildLeaderThreadResponseState(session, "q-42").pendingBatches[0]!.token;
    publishLeaderThreadResponse(
      session,
      { intent: "create", threadKey: "q-42", pendingBatchToken: token, baseRevisionId: null, markdown: "Done." },
      { now: 30, randomSuffix: "done" },
    );
    const ready = updateLeaderThreadStatusesForAssistantOutput(session, [marker("ready")], {
      messageId: "ready",
      timestamp: 40,
    });

    expect(ready.records).toEqual([expect.objectContaining({ kind: "ready", threadKey: "q-42" })]);
    expect(session.state.leaderThreadStatuses["q-42"]?.kind).toBe("ready");
  });
});
