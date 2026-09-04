import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "./session-types.js";
import {
  buildProgrammaticUserMessage,
  pauseSessionState,
  queuePausedUserMessage,
  unpauseSessionState,
} from "./session-pause.js";

function makeSession() {
  return {
    id: "session-1",
    state: { session_id: "session-1" } as SessionState,
  };
}

describe("session pause state", () => {
  it("preserves queued input order across unpause", () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const session = makeSession();
      pauseSessionState(session, { pausedBy: "operator", reason: "runaway loop" });

      queuePausedUserMessage(session, "browser", { type: "user_message", content: "first" });
      vi.advanceTimersByTime(10);
      queuePausedUserMessage(session, "programmatic", { type: "user_message", content: "second" });

      const queued = unpauseSessionState(session);

      expect(queued.map((item) => item.message.content)).toEqual(["first", "second"]);
      expect(queued.map((item) => item.source)).toEqual(["browser", "programmatic"]);
      expect(session.state.pause).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("persists outcome-reminder freshness guards across paused delivery", () => {
    const guard = {
      version: 1 as const,
      pendingResponseTargets: [
        {
          threadKey: "main",
          earliestTimestamp: 10,
          pendingAnswerCount: 1,
          pendingAnswerUserMessageIds: ["u1"],
        },
      ],
      missingOutcomeTargets: [],
      missingNeedsInputTargets: [],
    };

    const message = buildProgrammaticUserMessage({
      content: "deferred reminder",
      agentSource: { sessionId: "system:leader-thread-outcome-reminder" },
      options: { leaderThreadOutcomeReminderGuard: guard },
    });

    expect(message.leaderThreadOutcomeReminderGuard).toEqual(guard);
  });
});
