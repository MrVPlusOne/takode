import { describe, expect, it } from "vitest";
import {
  buildContextUsageHistoryEntry,
  computeContextUsedPercent,
  computeResultContextUsedPercent,
  extractClaudeTokenDetails,
  recordContextUsageHistory,
} from "./context-usage.js";

describe("context-usage helpers", () => {
  it("treats cache tokens as already included when they fit within input tokens", () => {
    // Copilot/OpenAI style accounting reports total prompt tokens in input_tokens,
    // so cache fields should not be added again.
    expect(
      computeContextUsedPercent(
        { input_tokens: 800, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 },
        1000,
      ),
    ).toBe(80);
  });

  it("falls back to result usage when assistant usage is zeroed out", () => {
    // Claude SDK can report zero usage on the assistant message while the result
    // carries the real per-turn numbers for the same request.
    expect(
      computeResultContextUsedPercent(
        undefined,
        {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          result: "",
          session_id: "s",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          uuid: "u1",
          usage: {
            input_tokens: 1000,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {
            claude: {
              inputTokens: 1000,
              outputTokens: 10,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              contextWindow: 2000,
              maxOutputTokens: 4096,
              costUSD: 0,
            },
          },
        },
        { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      ),
    ).toBe(50);
  });

  it("extracts non-zero Claude token details", () => {
    // The bridge only forwards token details when at least one field carries
    // useful information, avoiding empty noise in session state.
    expect(
      extractClaudeTokenDetails({
        claude: {
          inputTokens: 12,
          outputTokens: 7,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 2,
          contextWindow: 200_000,
          maxOutputTokens: 4096,
          costUSD: 0,
        },
      }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      cachedInputTokens: 5,
      modelContextWindow: 200_000,
    });
  });

  it("overrides modelContextWindow with 1M for [1m] model variants", () => {
    // CLI reports contextWindow: 200000 for the base model, but the session
    // model string contains [1m] indicating the 1M context variant.
    expect(
      extractClaudeTokenDetails(
        {
          "claude-opus-4-6": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextWindow: 200_000,
            maxOutputTokens: 32_000,
            costUSD: 0,
          },
        },
        "claude-opus-4-6[1m]",
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      modelContextWindow: 1_000_000,
    });
  });

  it("models reported Codex context usage separately from leader recycle thresholds", () => {
    // The history sample is reported runtime usage. The leader recycle budget
    // is captured as a separate comparison field, not collapsed into provider
    // or hidden-reasoning measurement.
    expect(
      buildContextUsageHistoryEntry(
        {
          context_used_percent: 42,
          codex_leader_recycle_threshold_tokens: 545_000,
          codex_token_details: {
            contextTokensUsed: 230_000,
            displayContextTokensUsed: 230_000,
            providerReportedTotalTokens: 235_000,
            inputTokens: 1_000_000,
            outputTokens: 10_000,
            cachedInputTokens: 700_000,
            reasoningOutputTokens: 4_000,
            modelContextWindow: 545_000,
          },
        },
        "codex_token_usage",
        123,
      ),
    ).toEqual({
      timestamp: 123,
      source: "codex_token_usage",
      contextUsedPercent: 42,
      contextTokensUsed: 230_000,
      displayContextTokensUsed: 230_000,
      providerReportedTotalTokens: 235_000,
      inputTokens: 1_000_000,
      outputTokens: 10_000,
      cachedInputTokens: 700_000,
      reasoningOutputTokens: 4_000,
      modelContextWindow: 545_000,
      leaderRecycleThresholdTokens: 545_000,
    });
  });

  it("records bounded context usage history only when reported values change", () => {
    // Duplicate token snapshots can be emitted repeatedly while streaming; the
    // persisted history should stay useful and bounded rather than growing on
    // identical reports.
    const session = {
      state: {
        context_used_percent: 10,
        claude_token_details: {
          inputTokens: 100,
          outputTokens: 5,
          cachedInputTokens: 0,
          modelContextWindow: 1_000,
        },
      },
      contextUsageHistory: [],
    };

    expect(recordContextUsageHistory(session, "claude_result_usage", 1)).toBe(true);
    expect(recordContextUsageHistory(session, "claude_result_usage", 2)).toBe(false);

    session.state.context_used_percent = 20;
    expect(recordContextUsageHistory(session, "claude_result_usage", 3)).toBe(true);
    expect(session.contextUsageHistory).toHaveLength(2);
    expect(session.contextUsageHistory.at(-1)).toMatchObject({ timestamp: 3, contextUsedPercent: 20 });
  });
});
