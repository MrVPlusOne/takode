import { describe, expect, it, vi } from "vitest";
import {
  THREAD_ROUTING_REMINDER_HEADER,
  THREAD_ROUTING_REMINDER_SOURCE_ID,
} from "../../shared/thread-routing-reminder.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { findFoldedResults } from "./folded-result-check.js";
import { validateLeaderThreadOutcomes } from "./leader-thread-outcome-validator.js";

// Jiayi (Nov 3): a leader posted a finished prototype's result, screenshots and a PR draft as
// commentary and marked the thread Ready. The feed folds commentary under Ready (and before a
// thread's newest answer), so the result vanished until Jiayi expanded the turn. The leader now
// gets a reminder at the end of such a turn.

function leaderMessage(
  id: string,
  text: string,
  timestamp: number,
  role: "commentary" | "answer" = "commentary",
  threadKey = "q-7",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    threadKey,
    leaderThreadRole: role,
    ...(threadKey !== "main"
      ? { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] }
      : {}),
  };
}

function ready(threadKey = "q-7", timestamp = 100): Record<string, LeaderThreadStatus> {
  return {
    [threadKey]: {
      kind: "ready",
      label: "Thread Ready",
      threadKey,
      questId: threadKey,
      summary: "done",
      messageId: "m",
      timestamp,
      updatedAt: timestamp,
    },
  };
}

const DRAFT = "The PR description:\n\n```draft\ntitle: Rollout Go redesign\n---\nRedesigned the trajectory view.\n```";
const SCREENSHOT = "Here it is: /home/coder/shots/trajectory-dark.png";

describe("findFoldedResults", () => {
  it("flags a draft posted as commentary whatever the thread's status", () => {
    expect(findFoldedResults([leaderMessage("m1", DRAFT, 1)], 0, undefined)).toEqual([
      { threadKey: "q-7", signals: ["a draft"] },
    ]);
  });

  it("flags screenshots, tables and long commentary only once the thread is Ready", () => {
    const history = [leaderMessage("m1", SCREENSHOT, 1)];
    expect(findFoldedResults(history, 0, undefined)).toEqual([]);
    expect(findFoldedResults(history, 0, ready())).toEqual([{ threadKey: "q-7", signals: ["images"] }]);
    const table = "| Run | Score |\n|---|---|\n| T7 | 0.3 |";
    expect(findFoldedResults([leaderMessage("m2", table, 1)], 0, ready())[0]?.signals).toEqual(["a table"]);
    expect(findFoldedResults([leaderMessage("m3", "x".repeat(1600), 1)], 0, ready())[0]?.signals).toEqual([
      "a long message",
    ]);
  });

  it("leaves ordinary progress notes, Main and commentary followed by an answer alone", () => {
    expect(findFoldedResults([leaderMessage("m1", "The worker started batch 2.", 1)], 0, ready())).toEqual([]);
    expect(findFoldedResults([leaderMessage("m1", DRAFT, 1, "commentary", "main")], 0, undefined)).toEqual([]);
    const answered = leaderMessage("m2", "The result.", 2, "answer");
    answered.threadAnswer = {
      version: 2,
      answerUserMessageIds: [],
      observedHistoryLength: 1,
      authoredThreadKey: "q-7",
      ownerGroups: [],
    };
    expect(findFoldedResults([leaderMessage("m1", DRAFT, 1), answered], 0, ready())).toEqual([]);
  });

  it("still flags it when the answer after it did not count, or a short note follows", () => {
    // An answer marker that was rejected is shown as commentary, so it folds away too.
    const rejected = leaderMessage("m2", "The result.", 2, "answer");
    const note = leaderMessage("m3", "Marked the thread Ready.", 3);
    expect(findFoldedResults([leaderMessage("m1", DRAFT, 1), rejected, note], 0, ready())).toEqual([
      { threadKey: "q-7", signals: ["a draft"] },
    ]);
  });
});

describe("folded-result reminder at the end of a leader turn", () => {
  function deps(turnSource: "leader" | "system" = "leader") {
    return {
      isLeaderSession: vi.fn(() => true),
      getTurnSource: vi.fn(() => turnSource),
      injectUserMessage: vi.fn(() => "sent" as const),
      persistSession: vi.fn(),
    };
  }

  it("reminds the leader once its threads have their outcomes", () => {
    const session = {
      id: "leader",
      messageHistory: [leaderMessage("m1", `${SCREENSHOT}\n\n${DRAFT}`, 20)],
      notifications: [],
      state: { leaderThreadStatuses: ready("q-7", 25) },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const d = deps();

    expect(validateLeaderThreadOutcomes(session, d)).toEqual({ checked: true, missing: [], injected: true });
    const [, content, source, route] = d.injectUserMessage.mock.calls[0] as unknown as [
      string,
      string,
      { sessionId: string },
      { threadKey: string },
    ];
    expect(content.split("\n")[0]).toBe(THREAD_ROUTING_REMINDER_HEADER);
    expect(content).toContain("q-7: commentary with a draft, images.");
    expect(source.sessionId).toBe(THREAD_ROUTING_REMINDER_SOURCE_ID);
    expect(route.threadKey).toBe("q-7");
  });

  it("does not remind on a system turn, such as the reminder's own reply", () => {
    const session = {
      id: "leader",
      messageHistory: [leaderMessage("m1", DRAFT, 20)],
      notifications: [],
      state: { leaderThreadStatuses: ready("q-7", 25) },
      leaderThreadOutcomeValidatedHistoryLength: 0,
    };
    const d = deps("system");
    validateLeaderThreadOutcomes(session, d);
    expect(d.injectUserMessage).not.toHaveBeenCalled();
  });
});
