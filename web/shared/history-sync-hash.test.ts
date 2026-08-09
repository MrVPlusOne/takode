import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../src/types.js";
import { computeHistoryMessagesSyncHash, computeHistoryPrefixSyncHash } from "./history-sync-hash.js";

describe("history-sync-hash", () => {
  it("produces a deterministic hash for a mixed history", () => {
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
      {
        type: "assistant",
        message: {
          id: "a1",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-20250514",
          content: [{ type: "text", text: "reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 2000,
      },
      {
        type: "permission_approved",
        id: "p1",
        request_id: "req-1",
        summary: "Approved Bash",
        timestamp: 3000,
        answers: [{ question: "Q", answer: "A" }],
      },
      {
        type: "result",
        data: {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["boom"],
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          session_id: "s1",
          uuid: "r1",
          stop_reason: "end_turn",
        },
      },
    ];

    const result = computeHistoryMessagesSyncHash(history);
    expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.renderedCount).toBe(4);
    expect(computeHistoryMessagesSyncHash(history).hash).toBe(result.hash);
  });

  it("produces different hashes when messages differ", () => {
    const history1: BrowserIncomingMessage[] = [{ type: "user_message", id: "u1", content: "hello", timestamp: 1000 }];
    const history2: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u2", content: "goodbye", timestamp: 1000 },
    ];

    expect(computeHistoryMessagesSyncHash(history1).hash).not.toBe(computeHistoryMessagesSyncHash(history2).hash);
  });

  it("uses identity-based hashing for messages with stable ids", () => {
    const history1: BrowserIncomingMessage[] = [{ type: "user_message", id: "u1", content: "hello", timestamp: 1000 }];
    const history2: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "goodbye", timestamp: 2000 },
    ];

    expect(computeHistoryMessagesSyncHash(history1).hash).toBe(computeHistoryMessagesSyncHash(history2).hash);
  });

  it("skips non-error result messages", () => {
    const withSuccess: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
      {
        type: "result",
        data: {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          session_id: "s1",
          uuid: "r1",
          stop_reason: "end_turn",
        },
      },
    ];
    const withoutResult: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
    ];

    expect(computeHistoryMessagesSyncHash(withSuccess).hash).toBe(computeHistoryMessagesSyncHash(withoutResult).hash);
    expect(computeHistoryMessagesSyncHash(withSuccess).renderedCount).toBe(1);
  });

  it("skips task_notification without summary", () => {
    const withNotif: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
      {
        type: "task_notification",
        task_id: "task-abc",
        tool_use_id: "tu-1",
        status: "running",
      },
    ];
    const withoutNotif: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
    ];

    expect(computeHistoryMessagesSyncHash(withNotif).hash).toBe(computeHistoryMessagesSyncHash(withoutNotif).hash);
  });

  it("skips root thinking-only assistant history entries when Codex suppression is enabled", () => {
    // Hash callers opt in only for Codex so rendered counts stay aligned without changing Claude history.
    const rootThinkingOnly: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
      {
        type: "assistant",
        message: {
          id: "a-thinking-root",
          type: "message",
          role: "assistant",
          model: "gpt-5.6-sol",
          content: [{ type: "thinking", thinking: "**Checking route fields**\n\nBody" }],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 1500,
      },
    ];
    const withoutThinking: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
    ];

    expect(computeHistoryMessagesSyncHash(rootThinkingOnly).renderedCount).toBe(2);
    const codexOptions = { suppressRootThinkingOnlyAssistant: true };
    expect(computeHistoryMessagesSyncHash(rootThinkingOnly, 0, codexOptions)).toEqual(
      computeHistoryMessagesSyncHash(withoutThinking, 0, codexOptions),
    );
  });

  it("counts parented thinking assistant history entries", () => {
    const history: BrowserIncomingMessage[] = [
      {
        type: "assistant",
        message: {
          id: "a-thinking-parented",
          type: "message",
          role: "assistant",
          model: "gpt-5.6-sol",
          content: [{ type: "thinking", thinking: "Scoped subagent reasoning" }],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: "agent-1",
        timestamp: 1500,
      },
    ];

    expect(computeHistoryMessagesSyncHash(history, 0, { suppressRootThinkingOnlyAssistant: true }).renderedCount).toBe(
      1,
    );
  });

  it("includes task_notification with summary", () => {
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
      {
        type: "task_notification",
        task_id: "task-abc",
        tool_use_id: "tu-1",
        status: "completed",
        summary: "Background agent finished",
      },
    ];

    const result = computeHistoryMessagesSyncHash(history);
    expect(result.renderedCount).toBe(2);
    const withoutNotif: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
    ];
    expect(result.hash).not.toBe(computeHistoryMessagesSyncHash(withoutNotif).hash);
  });

  it("computes prefix hash for a subset of rendered messages", () => {
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "hello", timestamp: 1000 },
      {
        type: "assistant",
        message: {
          id: "a1",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-20250514",
          content: [{ type: "text", text: "reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 2000,
      },
      { type: "user_message", id: "u2", content: "follow up", timestamp: 3000 },
    ];

    const full = computeHistoryMessagesSyncHash(history);
    expect(full.renderedCount).toBe(3);

    const prefix = computeHistoryPrefixSyncHash(history, 2);
    expect(prefix.renderedCount).toBe(2);
    expect(prefix.totalRenderedCount).toBe(3);
    expect(prefix.sourceCount).toBe(2);

    const firstTwo = computeHistoryMessagesSyncHash(history.slice(0, 2));
    expect(prefix.hash).toBe(firstTwo.hash);

    expect(prefix.hash).not.toBe(full.hash);
  });

  it("maps a rendered Codex prefix count to its raw history boundary", () => {
    // Incremental sync slices raw history, so a suppressed entry before the cached row must not shift that slice.
    const history: BrowserIncomingMessage[] = [
      {
        type: "assistant",
        message: {
          id: "root-thinking",
          type: "message",
          role: "assistant",
          model: "provider-model",
          content: [{ type: "thinking", thinking: "Transient reasoning" }],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
      },
      { type: "user_message", id: "u1", content: "cached visible row", timestamp: 1000 },
      { type: "user_message", id: "u2", content: "new visible row", timestamp: 2000 },
    ];

    const prefix = computeHistoryPrefixSyncHash(history, 1, 0, { suppressRootThinkingOnlyAssistant: true });
    expect(prefix.renderedCount).toBe(1);
    expect(prefix.totalRenderedCount).toBe(2);
    expect(prefix.sourceCount).toBe(2);
  });

  it("handles empty history", () => {
    const result = computeHistoryMessagesSyncHash([]);
    expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.renderedCount).toBe(0);
  });

  it("handles compact markers", () => {
    const history: BrowserIncomingMessage[] = [
      {
        type: "compact_marker",
        id: "compact-boundary-1",
        timestamp: 123,
        summary: "Conversation compacted to summary",
      },
    ];

    const result = computeHistoryMessagesSyncHash(history);
    expect(result.renderedCount).toBe(1);
    expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when a mutable recovery summary settles under the same stable id", () => {
    // Unlike immutable protocol IDs, this server-authored history row is updated in place as outcomes arrive.
    const base = {
      type: "codex_auto_pause_recovery_summary" as const,
      id: "recovery-summary",
      timestamp: 100,
      content: "Automatic input recovery: 1 awaiting delivery.",
      searchText: "automatic input recovery outcome:released_to_delivery",
      recovery: {
        family: "copilot_auth_refresh_exhausted" as const,
        pausedAt: 10,
        recoveryConfirmedAt: 20,
        updatedAt: 100,
        status: "releasing" as const,
        receipts: [],
      },
    };
    const settled = {
      ...base,
      content: "Automatic input recovery: 1 delivered.",
      recovery: { ...base.recovery, updatedAt: 200, status: "settled" as const },
    };

    expect(computeHistoryMessagesSyncHash([base]).hash).not.toBe(computeHistoryMessagesSyncHash([settled]).hash);
  });
});
