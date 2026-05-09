import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import { computeSessionTurnMetrics, getLastActualHumanUserMessageTimestamp } from "./user-message-classification.js";
import { LEADER_KICKOFF_PREFIX, STANDARD_COMPACTION_RECOVERY_PREFIX } from "../shared/injected-event-message.js";

function user(content: string, timestamp: number, agentSource?: { sessionId: string; sessionLabel?: string }) {
  return {
    type: "user_message",
    id: `u-${timestamp}`,
    content,
    timestamp,
    ...(agentSource ? { agentSource } : {}),
  } as BrowserIncomingMessage;
}

function assistant(id: string) {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.5",
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: Date.now(),
  } as BrowserIncomingMessage;
}

function result(id: string, numTurns: number) {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: numTurns,
      total_cost_usd: 0,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: id,
      session_id: "s1",
    },
  } as BrowserIncomingMessage;
}

describe("user-message-classification", () => {
  it("counts real user turns in Codex-shaped history without trusting per-result num_turns", () => {
    // Codex result payloads may report num_turns: 1 for every turn. The metric
    // must come from server history and skip system/event user-shaped prompts.
    const metrics = computeSessionTurnMetrics([
      user("First human request", 100),
      assistant("a1"),
      result("r1", 1),
      user("Herd event", 200, { sessionId: "herd-events", sessionLabel: "Herd" }),
      assistant("a-herd"),
      result("r-herd", 1),
      user(`${STANDARD_COMPACTION_RECOVERY_PREFIX}\nRecover context.`, 300),
      user("Second human request", 400),
      assistant("a2"),
      result("r2", 1),
    ]);

    expect(metrics).toEqual({ userTurnCount: 2, agentTurnCount: 3 });
  });

  it("counts real user turns in Claude-shaped history across compaction resets", () => {
    // Claude CLI counts can reset or diverge around compaction; real user turns
    // remain the human-authored user_message entries in backend history.
    const history = [
      user("First human request", 100),
      assistant("a1"),
      result("r1", 1),
      { type: "compact_marker", id: "compact-1", timestamp: 200 } as BrowserIncomingMessage,
      user(`${LEADER_KICKOFF_PREFIX}\nLeader guardrails.`, 250),
      user("Compaction recovery", 300, { sessionId: "system:compaction-recovery", sessionLabel: "System" }),
      user("Second human request", 400),
      assistant("a2"),
      result("r2-reset", 1),
    ];

    expect(computeSessionTurnMetrics(history)).toEqual({ userTurnCount: 2, agentTurnCount: 2 });
    expect(getLastActualHumanUserMessageTimestamp(history)).toBe(400);
  });

  it("defines agent turns as completed result-backed top-level assistant spans", () => {
    // A bare result without assistant output is not counted as an agent turn;
    // an in-progress assistant without a result is not counted until completion.
    const metrics = computeSessionTurnMetrics([
      user("Request", 100),
      result("empty", 1),
      assistant("a1"),
      result("complete", 1),
      assistant("in-progress"),
    ]);

    expect(metrics).toEqual({ userTurnCount: 1, agentTurnCount: 1 });
  });
});
