import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionNotification } from "../session-types.js";
import { validateLeaderThreadOutcomes } from "./leader-thread-outcome-validator.js";

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

function makeDeps(isLeaderSession = true) {
  return {
    isLeaderSession: vi.fn(() => isLeaderSession),
    injectUserMessage: vi.fn(() => "sent" as const),
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
      leaderThreadOutcomeValidatedHistoryLength: undefined as number | undefined,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: [], injected: false });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(1);
  });

  it("rejects stale same-thread markers when leader output is newer", () => {
    const session = {
      id: "leader",
      messageHistory: [
        assistantMessage({ id: "a1", text: "Old update", timestamp: 20, threadKey: "q-42" }),
        assistantMessage({ id: "a2", text: "New update without outcome", timestamp: 40, threadKey: "q-42" }),
      ],
      notifications: [notification({ category: "waiting", timestamp: 30, threadKey: "q-42" })],
      leaderThreadOutcomeValidatedHistoryLength: undefined as number | undefined,
    };
    const deps = makeDeps();

    const result = validateLeaderThreadOutcomes(session, deps);

    expect(result).toEqual({ checked: true, missing: ["q-42"], injected: true });
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      "leader",
      expect.stringContaining("Missing outcome marker for: q-42."),
      expect.objectContaining({ sessionId: "system:leader-thread-outcome-reminder" }),
      expect.objectContaining({ threadKey: "q-42" }),
    );
    expect(session.leaderThreadOutcomeValidatedHistoryLength).toBe(2);
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
