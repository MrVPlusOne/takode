import { describe, expect, it, vi } from "vitest";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { BrowserIncomingMessage, SessionNotification } from "../session-types.js";
import type { ThreadRouteMetadata } from "../thread-routing-metadata.js";
import {
  THREAD_RESPONSE_REMINDER_SOURCE_ID,
  validateLeaderThreadOutcomes,
  type LeaderThreadOutcomeTurnSource,
} from "./leader-thread-outcome-validator.js";
import { finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";

function assistantMessage({
  id,
  text,
  timestamp,
  threadKey = "main",
}: {
  id: string;
  text: string;
  timestamp: number;
  threadKey?: string;
}): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: null,
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
    ...(threadKey !== "main"
      ? {
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
        }
      : {}),
  };
}

function threadStatus({
  kind,
  timestamp,
  threadKey = "main",
  messageId = `a-${timestamp}`,
}: {
  kind: LeaderThreadStatus["kind"];
  timestamp: number;
  threadKey?: string;
  messageId?: string;
}): LeaderThreadStatus {
  return {
    kind,
    label: kind === "waiting" ? "Thread Waiting" : "Thread Ready",
    threadKey,
    ...(threadKey !== "main" ? { questId: threadKey } : {}),
    summary: kind === "waiting" ? "waiting on reviewer" : "ready for review",
    messageId,
    timestamp,
    updatedAt: timestamp,
  };
}

function systemUserMessage({
  id,
  timestamp,
  threadKey = "main",
}: {
  id: string;
  timestamp: number;
  threadKey?: string;
}) {
  return {
    type: "user_message",
    id,
    content: "Thread outcome reminder",
    timestamp,
    agentSource: {
      sessionId: THREAD_OUTCOME_REMINDER_SOURCE_ID,
      sessionLabel: THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
    },
    threadKey,
    ...(threadKey !== "main"
      ? {
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
        }
      : {}),
  } satisfies BrowserIncomingMessage;
}

function notification({
  category,
  timestamp,
  threadKey = "main",
  done = false,
}: {
  category: SessionNotification["category"];
  timestamp: number;
  threadKey?: string;
  done?: boolean;
}): SessionNotification {
  return {
    id: `n-${timestamp}`,
    category,
    summary: category,
    timestamp,
    messageId: null,
    threadKey,
    ...(threadKey !== "main" ? { questId: threadKey } : {}),
    done,
  };
}

function makeDeps(isLeaderSession = true, turnSource: LeaderThreadOutcomeTurnSource = "leader") {
  return {
    isLeaderSession: vi.fn(() => isLeaderSession),
    getTurnSource: vi.fn(() => turnSource),
    injectUserMessage: vi.fn(
      (
        _sessionId: string,
        _content: string,
        _agentSource: { sessionId: string; sessionLabel?: string },
        _threadRoute?: ThreadRouteMetadata,
      ) => "sent" as const,
    ),
    persistSession: vi.fn(),
  };
}

describe("validateLeaderThreadOutcomes", () => {
  it("does not enforce outcome markers for non-leader sessions", () => {
    const session = {
      id: "worker",
      messageHistory: [assistantMessage({ id: "a1", text: "Visible worker text", timestamp: 20 })],
      notifications: [],
      leaderThreadOutcomeValidatedHistoryLength: undefined as number | undefined,
    };
    const deps = makeDeps(false);

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: false, reason: "not_leader" });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBeUndefined();
  });

  it("accepts a same-thread waiting marker newer than the touched leader output", () => {
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "a1", text: "Waiting on reviewer", timestamp: 20 })],
      notifications: [notification({ category: "waiting", timestamp: 25 })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(1);
  });

  it("accepts a same-thread needs-input notification as the user-blocking outcome", () => {
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "a1", text: "Approve this quest?", timestamp: 20 })],
      notifications: [notification({ category: "needs-input", timestamp: 25 })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("injects a needs-input reminder for approval-like leader text covered only by Thread Waiting", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({
          id: "a1",
          text: "Proposed quest:\n\n- Title: Prevent missed notifications",
          timestamp: 20,
          threadKey: "q-1474",
        }),
      ],
      notifications: [notification({ category: "needs-input", timestamp: 10, threadKey: "q-1474" })],
      state: {
        leaderThreadStatuses: { "q-1474": threadStatus({ kind: "waiting", timestamp: 25, threadKey: "q-1474" }) },
      },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["q-1474"], injected: true });
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      "leader",
      expect.stringContaining("no fresh same-thread `takode notify needs-input` notification was created"),
      expect.objectContaining({
        sessionId: THREAD_OUTCOME_REMINDER_SOURCE_ID,
        sessionLabel: THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      }),
      expect.objectContaining({ threadKey: "q-1474" }),
    );
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain(
      "Existing unresolved needs-input prompts do not cover a new approval or decision prompt.",
    );
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain(
      "it is not diagnosing missing `[thread:...]` visible-text markers or `# thread:...` shell-command markers",
    );
  });

  it("accepts approval-like leader text when a fresh same-thread needs-input notification exists", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({
          id: "a1",
          text: "**Proposed Quest**\n\nDecision needed: approve dispatch?",
          timestamp: 20,
          threadKey: "q-1476",
        }),
      ],
      notifications: [notification({ category: "needs-input", timestamp: 25, threadKey: "q-1476" })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("does not treat ordinary status summaries mentioning a proposed quest as blocking prompts", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({
          id: "a1",
          text: "The proposed quest was approved earlier, and I dispatched the worker.",
          timestamp: 20,
          threadKey: "q-1476",
        }),
      ],
      notifications: [notification({ category: "waiting", timestamp: 25, threadKey: "q-1476" })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("rejects resolved needs-input notifications as active outcomes", () => {
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "a1", text: "Approve this quest?", timestamp: 20 })],
      notifications: [notification({ category: "needs-input", timestamp: 25, done: true })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["main"], injected: true });
  });

  it("warns leaders to verify promised durable actions before marking Ready", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({
          id: "a1",
          text: "I'll create and dispatch a follow-up quest for this thread.",
          timestamp: 20,
          threadKey: "q-1661",
        }),
      ],
      notifications: [],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["q-1661"], injected: true });
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain(
      "Before marking a thread Ready, verify any promised durable action is actually complete",
    );
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain(
      "quest creation/refinement, board rows, needs-input notifications, worker sends, phase dispatches, Port/push",
    );
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain("mark the thread Waiting or incomplete instead");
  });

  it("accepts a fresh inline Thread Waiting marker from server status state", () => {
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "a1", text: "Waiting on reviewer", timestamp: 20, threadKey: "q-42" })],
      notifications: [],
      state: { leaderThreadStatuses: { "q-42": threadStatus({ kind: "waiting", timestamp: 25, threadKey: "q-42" }) } },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("accepts a fresh inline Thread Ready marker from server status state", () => {
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "a1", text: "Review complete", timestamp: 20, threadKey: "q-42" })],
      notifications: [],
      state: { leaderThreadStatuses: { "q-42": threadStatus({ kind: "ready", timestamp: 25, threadKey: "q-42" }) } },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("rejects stale inline status markers when leader output is newer", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "a1", text: "Old update", timestamp: 20, threadKey: "q-42" }),
        assistantMessage({ id: "a2", text: "New update without outcome", timestamp: 40, threadKey: "q-42" }),
      ],
      notifications: [],
      state: { leaderThreadStatuses: { "q-42": threadStatus({ kind: "ready", timestamp: 30, threadKey: "q-42" }) } },
      leaderThreadOutcomeValidatedHistoryLength: 1,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["q-42"], injected: true });
  });

  it("rejects stale same-thread markers when leader output is newer", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "a1", text: "Old update", timestamp: 20, threadKey: "q-42" }),
        assistantMessage({ id: "a2", text: "New update without outcome", timestamp: 40, threadKey: "q-42" }),
      ],
      notifications: [notification({ category: "waiting", timestamp: 30, threadKey: "q-42" })],
      leaderThreadOutcomeValidatedHistoryLength: 1,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["q-42"], injected: true });
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      "leader",
      expect.stringContaining("Missing outcome marker for: q-42."),
      expect.objectContaining({
        sessionId: THREAD_OUTCOME_REMINDER_SOURCE_ID,
        sessionLabel: THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      }),
      expect.objectContaining({ threadKey: "q-42" }),
    );
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain(
      "This is about outcome status for already routed leader output",
    );
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(2);
  });

  it("does not repeat reminders when unchanged history was already validated", () => {
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "a1", text: "Update without outcome", timestamp: 20 })],
      notifications: [],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const firstResult = validateLeaderThreadOutcomes(session, deps);
    const secondResult = validateLeaderThreadOutcomes(session, deps);

    expect(firstResult).toEqual({ checked: true, missing: ["main"], injected: true });
    expect(secondResult).toEqual({ checked: false, reason: "no_new_history" });
    expect(deps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(deps.persistSession).toHaveBeenCalledTimes(1);
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(1);
  });

  it("accepts a same-turn waiting marker even when a final acknowledgement is newer", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "a1", text: "Marking q-1255 as waiting", timestamp: 20, threadKey: "q-1255" }),
        assistantMessage({ id: "a2", text: "Waiting marker refreshed", timestamp: 40, threadKey: "q-1255" }),
      ],
      notifications: [notification({ category: "waiting", timestamp: 30, threadKey: "q-1255" })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(2);
  });

  it("does not self-loop on system-triggered reminder recovery turns", () => {
    const session = {
      id: "leader",
      messageHistory: [
        systemUserMessage({ id: "u-reminder", timestamp: 10, threadKey: "q-1255" }),
        assistantMessage({ id: "a1", text: "Re-marking q-1255 as waiting", timestamp: 20, threadKey: "q-1255" }),
        assistantMessage({ id: "a2", text: "Marked again", timestamp: 40, threadKey: "q-1255" }),
      ],
      notifications: [notification({ category: "waiting", timestamp: 30, threadKey: "q-1255" })],
      leaderThreadOutcomeValidatedHistoryLength: 1,
    };
    const deps = makeDeps(true, "system");

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: false, reason: "system_turn" });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(3);
  });

  it("does not repeat a reminder after the leader marks the thread waiting", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "a1", text: "q-1255 is in Code Review", timestamp: 10, threadKey: "q-1255" }),
      ],
      notifications: [] as SessionNotification[],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();
    deps.injectUserMessage.mockImplementation((sessionId, content, agentSource, threadRoute) => {
      session.messageHistory.push(
        systemUserMessage({
          id: `u-${sessionId}-${session.messageHistory.length}`,
          timestamp: 15,
          threadKey: threadRoute?.threadKey ?? "main",
        }),
      );
      expect(content).toContain("Missing outcome marker for: q-1255.");
      expect(agentSource.sessionId).toBe(THREAD_OUTCOME_REMINDER_SOURCE_ID);
      expect(agentSource.sessionLabel).toBe(THREAD_OUTCOME_REMINDER_SOURCE_LABEL);
      return "sent";
    });

    const firstResult = validateLeaderThreadOutcomes(session, deps);
    session.messageHistory.push(
      assistantMessage({ id: "a2", text: "Re-marking q-1255 as waiting", timestamp: 20, threadKey: "q-1255" }),
      assistantMessage({ id: "a3", text: "Marked again", timestamp: 40, threadKey: "q-1255" }),
    );
    session.notifications.push(notification({ category: "waiting", timestamp: 30, threadKey: "q-1255" }));
    const secondResult = validateLeaderThreadOutcomes(session, deps);

    expect(firstResult).toEqual({ checked: true, missing: ["q-1255"], injected: true });
    expect(secondResult).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(4);
  });

  it("checks freshness independently per touched thread", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "a-main", text: "Main update", timestamp: 20 }),
        assistantMessage({ id: "a-quest", text: "Quest update", timestamp: 30, threadKey: "q-77" }),
      ],
      notifications: [notification({ category: "needs-input", timestamp: 35, threadKey: "q-77" })],
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["main"], injected: true });
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      "leader",
      expect.stringContaining("Missing outcome marker for: Main."),
      expect.anything(),
      expect.objectContaining({ threadKey: "main" }),
    );
  });
});

function coveredHumanMessage(id: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    leaderUserMessageId: /^u[1-9]\d*$/.test(id) ? id : undefined,
    content: `Ask ${id}`,
    timestamp,
    threadKey,
    leaderResponseCoverageVersion: 1,
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] }),
  };
}

describe("explicit answer reminders", () => {
  it("reminds after a post-cutover direct user message is left uncovered", () => {
    const session = {
      id: "leader",
      messageHistory: [coveredHumanMessage("u1", 10, "q-42")],
      notifications: [],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["q-42"], injected: true });
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      "leader",
      expect.stringContaining("Pending answer IDs: q-42 (u1)."),
      expect.objectContaining({ sessionId: THREAD_RESPONSE_REMINDER_SOURCE_ID }),
      expect.objectContaining({ threadKey: "q-42" }),
    );
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain("[thread:q-N:A:u1,u2]");
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain("takode read leader u1");
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).not.toContain("Ask u1");
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).not.toContain("batch");
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).not.toContain("response-batch-v1");
  });

  it("uses an explicit rejected Ready target to remind after a marker-only turn", () => {
    const pending = coveredHumanMessage("u1", 10, "q-42") as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    pending.content = "Please compare the two deployment options before deciding.";
    pending.images = [
      { id: "image-1", filename: "option.png", media_type: "image/png", size: 10, created_at: 10 } as any,
    ];
    const session = {
      id: "leader",
      messageHistory: [pending] as BrowserIncomingMessage[],
      notifications: [],
      leaderThreadOutcomeValidatedHistoryLength: 1,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps, { rejectedReadyThreadKeys: ["q-42"] })).toEqual({
      checked: false,
      reason: "no_new_history",
    });

    session.messageHistory.push(assistantMessage({ id: "marker-only", text: "", timestamp: 20, threadKey: "q-42" }));
    expect(validateLeaderThreadOutcomes(session, deps, { rejectedReadyThreadKeys: ["q-42"] })).toEqual({
      checked: true,
      missing: ["q-42"],
      injected: true,
    });
    const reminder = deps.injectUserMessage.mock.calls.at(-1)?.[1] ?? "";
    expect(reminder).toContain("Pending answer IDs: q-42 (u1)");
    expect(reminder).toContain("takode read leader u1");
    expect(reminder).not.toContain("Please compare the two deployment options");
    expect(reminder).not.toContain("option.png");
  });

  it("forces the pending-response reminder when rejected Ready is followed by fresh Waiting", () => {
    const session = {
      id: "leader",
      messageHistory: [
        coveredHumanMessage("u1", 10, "q-42"),
        assistantMessage({ id: "ready-then-waiting", text: "Still working.", timestamp: 20, threadKey: "q-42" }),
      ],
      notifications: [],
      state: {
        leaderThreadStatuses: {
          "q-42": threadStatus({ kind: "waiting", timestamp: 20, threadKey: "q-42" }),
        },
      },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps, { rejectedReadyThreadKeys: ["q-42"] })).toEqual({
      checked: true,
      missing: ["q-42"],
      injected: true,
    });
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain("Answer reminder");
    expect(deps.injectUserMessage.mock.calls[0]?.[1]).toContain("q-42 (u1)");
  });

  it("defers recovered Ready rejection until the next normal validation boundary", () => {
    const session = {
      id: "leader",
      messageHistory: [coveredHumanMessage("u1", 10, "q-42")] as BrowserIncomingMessage[],
      notifications: [],
      state: {
        leaderThreadStatuses: {
          "q-42": threadStatus({ kind: "waiting", timestamp: 20, threadKey: "q-42" }),
        },
      },
      leaderThreadOutcomeValidatedHistoryLength: 1,
      pendingLeaderRejectedReadyThreadKeys: ["q-42"],
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: false, reason: "no_new_history" });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.pendingLeaderRejectedReadyThreadKeys).toEqual(["q-42"]);

    deps.getTurnSource.mockReturnValue("system");
    session.messageHistory.push(
      assistantMessage({ id: "replay-boundary", text: "Recovered history.", timestamp: 25, threadKey: "q-42" }),
    );
    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: false, reason: "system_turn" });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.pendingLeaderRejectedReadyThreadKeys).toEqual(["q-42"]);

    deps.getTurnSource.mockReturnValue("leader");
    session.messageHistory.push(
      assistantMessage({ id: "normal-boundary", text: "Still working.", timestamp: 30, threadKey: "q-42" }),
    );
    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({
      checked: true,
      missing: ["q-42"],
      injected: true,
    });
    expect(deps.injectUserMessage.mock.calls.at(-1)?.[1]).toContain("Answer reminder");
    expect(session.pendingLeaderRejectedReadyThreadKeys).toEqual([]);
  });

  it("lists accepted uncommitted Codex IDs when a queued request blocks Ready", () => {
    // The reminder can name queued uN obligations but must not advertise history-only read retrieval yet.
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "ready-attempt", text: "Completed earlier work.", timestamp: 20, threadKey: "q-42" }),
      ],
      pendingCodexInputs: [
        {
          id: "raw-u2",
          content: "Queued direct request",
          timestamp: 30,
          cancelable: true,
          leaderResponseCoverageVersion: 1 as const,
          leaderUserMessageId: "u2",
          threadKey: "q-42",
          questId: "q-42",
          threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" as const }],
        },
      ],
      notifications: [],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps, { rejectedReadyThreadKeys: ["q-42"] })).toEqual({
      checked: true,
      missing: ["q-42"],
      injected: true,
    });
    const reminder = deps.injectUserMessage.mock.calls[0]?.[1] ?? "";
    expect(reminder).toContain("Pending answer IDs: q-42 (u2)");
    expect(reminder).not.toContain("takode read leader u2");
  });

  it("repairs persisted Ready state when a same-thread needs-input remains unresolved", () => {
    // Restored sessions may carry pre-fix Ready state that conflicts with durable notification authority.
    const session = {
      id: "leader",
      messageHistory: [assistantMessage({ id: "already-validated", text: "Earlier answer.", timestamp: 20 })],
      notifications: [notification({ category: "needs-input", timestamp: 25 })],
      state: { leaderThreadStatuses: { main: threadStatus({ kind: "ready", timestamp: 30 }) } },
      leaderThreadOutcomeValidatedHistoryLength: 1,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: false, reason: "no_new_history" });
    expect(session.state.leaderThreadStatuses.main).toBeUndefined();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("allows a pending answer to remain open behind a fresh Waiting marker", () => {
    const session = {
      id: "leader",
      messageHistory: [
        coveredHumanMessage("u1", 10, "q-42"),
        assistantMessage({ id: "a1", text: "Reviewer still running", timestamp: 20, threadKey: "q-42" }),
      ],
      notifications: [],
      state: { leaderThreadStatuses: { "q-42": threadStatus({ kind: "waiting", timestamp: 20, threadKey: "q-42" }) } },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("does not let Ready or review state cover a still-pending answer", () => {
    const session = {
      id: "leader",
      messageHistory: [coveredHumanMessage("u1", 10)],
      notifications: [notification({ category: "review", timestamp: 20 })],
      state: { leaderThreadStatuses: { main: threadStatus({ kind: "ready", timestamp: 20 }) } },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: true, missing: ["main"], injected: true });
  });

  it("requires the needs-input notification to follow the actual blocking prompt", () => {
    const session = {
      id: "leader",
      messageHistory: [
        coveredHumanMessage("u1", 10),
        assistantMessage({ id: "a1", text: "Decision needed: choose the rollout.", timestamp: 30 }),
      ],
      notifications: [notification({ category: "needs-input", timestamp: 20 })],
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: true, missing: ["main"], injected: true });
    const reminder = deps.injectUserMessage.mock.calls[0]?.[1] ?? "";
    expect(reminder).toContain("Needs-input notification reminder");
    expect(reminder).toContain("[thread:main:C]");
    expect(reminder).toContain("[thread:q-N:C]");
    expect(reminder).toContain("later explicit `[thread:main:A:u1]` or `[thread:q-N:A:u1]` answer");
    expect(reminder).not.toContain("Publish or revise the covering thread response");
  });

  it("accepts Ready after the exact pending answer has a current response", () => {
    const session = {
      id: "leader",
      messageHistory: [coveredHumanMessage("u1", 10)] as BrowserIncomingMessage[],
      notifications: [],
      state: { leaderThreadStatuses: {} as Record<string, ReturnType<typeof threadStatus>> },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const response = assistantMessage({ id: "ready-response", text: "Answer.", timestamp: 20 }) as Extract<
      BrowserIncomingMessage,
      { type: "assistant" }
    >;
    response.leaderThreadRole = "answer";
    response.leaderAnswerUserMessageIds = ["u1"];
    response.leaderAnswerObservedHistoryLength = 1;
    session.messageHistory.push(response);
    expect(finalizeRoutedLeaderResponseMessage(session, response)).toMatchObject({ finalized: true });
    session.state.leaderThreadStatuses.main = threadStatus({
      kind: "ready",
      timestamp: 30,
      messageId: response.message.id,
    });
    const deps = makeDeps();

    expect(validateLeaderThreadOutcomes(session, deps)).toEqual({ checked: true, missing: [], injected: false });
  });
});
