import { describe, expect, it } from "vitest";
import { buildContextDiagnostics } from "./context-diagnostics.js";
import type { BrowserIncomingMessage } from "./session-types.js";

describe("buildContextDiagnostics", () => {
  it("summarizes observable messages, tool-result payloads, and explicit reveal history", () => {
    // The diagnostic model should expose compact size summaries and drill-down
    // commands by default, while keeping usage-history samples behind the
    // explicit includeHistory option.
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", content: "please inspect files", timestamp: 100 },
      {
        type: "assistant",
        timestamp: 110,
        parent_tool_use_id: null,
        message: {
          id: "a1",
          type: "message",
          role: "assistant",
          model: "gpt-5.5",
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "large.txt" } }],
        },
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "tool-1",
            content: "tail",
            is_error: false,
            total_size: 4_000,
            is_truncated: true,
          },
        ],
      },
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
          stop_reason: null,
          result: "done",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          uuid: "result-1",
          session_id: "s1",
        },
      },
    ];

    const compact = buildContextDiagnostics(
      {
        id: "s1",
        messageHistory: history,
        toolResults: new Map([["tool-1", { content: "x".repeat(5_000) }]]),
        contextUsageHistory: [{ timestamp: 123, source: "codex_token_usage", contextUsedPercent: 31 }],
      },
      { sessionNum: 42, limit: 2 },
    );

    expect(compact.contextUsageHistoryCount).toBe(1);
    expect(compact).not.toHaveProperty("contextUsageHistory");
    expect(compact.history.toolResultBytes).toBe(5_000);
    expect(compact.history.hiddenToolResultBytes).toBe(4_996);
    expect(compact.history.totalObservableBytes).toBe(compact.history.messageJsonBytes + 4_996);
    expect(compact.topTurns[0]?.totalObservableBytes).toBe(compact.topTurns[0]!.messageBytes + 4_996);
    expect(compact.byTool.Read).toMatchObject({ calls: 1, resultBytes: 5_000, hiddenResultBytes: 4_996 });
    expect(compact.topEntries[0]).toMatchObject({
      kind: "tool_result",
      messageIndex: 2,
      turn: 0,
      toolName: "Read",
      readCommand: "takode read 42 2",
      peekCommand: "takode peek 42 --turn-containing 2",
    });

    const revealed = buildContextDiagnostics(
      {
        id: "s1",
        messageHistory: history,
        toolResults: new Map(),
        contextUsageHistory: [{ timestamp: 123, source: "codex_token_usage", contextUsedPercent: 31 }],
      },
      { includeHistory: true },
    );
    expect(revealed.contextUsageHistory).toEqual([
      { timestamp: 123, source: "codex_token_usage", contextUsedPercent: 31 },
    ]);
  });

  it("breaks Bash payloads down by command family and keeps command summaries compact", () => {
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", content: "inspect quest", timestamp: 100 },
      {
        type: "assistant",
        timestamp: 110,
        parent_tool_use_id: null,
        message: {
          id: "a1",
          type: "message",
          role: "assistant",
          model: "gpt-5.5",
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          content: [
            {
              type: "tool_use",
              id: "bash-quest",
              name: "Bash",
              input: { command: "quest show q-1452", description: "Show quest q-1452" },
            },
          ],
        },
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "bash-quest",
            content: "Quest detail preview",
            is_error: false,
            total_size: 29_400,
            is_truncated: true,
          },
        ],
      },
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
          stop_reason: null,
          result: "done",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          uuid: "result-1",
          session_id: "s1",
        },
      },
    ];

    const diagnostics = buildContextDiagnostics(
      { id: "s1", messageHistory: history, toolResults: new Map() },
      { sessionNum: 42, limit: 3 },
    );

    expect(diagnostics.byTool.Bash).toMatchObject({ calls: 1, resultBytes: 29_400 });
    expect(diagnostics.byCommandFamily["quest show"]).toMatchObject({ calls: 1, resultBytes: 29_400 });
    expect(diagnostics.topEntries[0]).toMatchObject({
      kind: "tool_result",
      toolName: "Bash",
      commandFamily: "quest show",
      commandSummary: "Show quest q-1452",
    });
  });
});
