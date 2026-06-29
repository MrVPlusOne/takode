import { describe, expect, it } from "vitest";
import type { SessionState, SdkSessionInfo } from "../types.js";
import {
  coalesceSessionViewModel,
  resolveEffectiveModelContextWindow,
  toSessionViewModel,
} from "./session-view-model.js";

const codexTokenDetails = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
  modelContextWindow: 258_400,
};

describe("toSessionViewModel", () => {
  it("maps SessionState snake_case fields to camelCase", () => {
    const session = {
      session_id: "s1",
      backend_type: "codex",
      model: "gpt-5",
      cwd: "/repo",
      tools: [],
      permissionMode: "plan",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 1.25,
      num_turns: 3,
      context_used_percent: 42,
      codex_retained_payload_bytes: 2_048,
      codex_token_details: codexTokenDetails,
      is_compacting: false,
      git_branch: "jiayi",
      is_worktree: true,
      is_containerized: false,
      repo_root: "/repo",
      git_ahead: 2,
      git_behind: 1,
      total_lines_added: 10,
      total_lines_removed: 4,
    } as SessionState;

    const vm = toSessionViewModel(session);

    expect(vm.sessionId).toBe("s1");
    expect(vm.backendType).toBe("codex");
    expect(vm.gitBranch).toBe("jiayi");
    expect(vm.repoRoot).toBe("/repo");
    expect(vm.totalLinesAdded).toBe(10);
    expect(vm.totalCostUsd).toBe(1.25);
    expect(vm.codexRetainedPayloadBytes).toBe(2_048);
    expect(vm.modelContextWindow).toBe(258_400);
  });

  it("maps SdkSessionInfo camelCase fields directly", () => {
    const sdk = {
      sessionId: "s2",
      state: "connected",
      cwd: "/work",
      createdAt: 1,
      backendType: "claude",
      gitBranch: "main",
      gitAhead: 0,
      gitBehind: 0,
      totalLinesAdded: 3,
      totalLinesRemoved: 2,
      contextUsedPercent: 27,
      codexRetainedPayloadBytes: 4_096,
      codexTokenDetails,
      repoRoot: "/work",
      sessionNum: 9,
      name: "Test",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    } as SdkSessionInfo;

    const vm = toSessionViewModel(sdk);

    expect(vm.sessionId).toBe("s2");
    expect(vm.backendType).toBe("claude");
    expect(vm.gitBranch).toBe("main");
    expect(vm.totalLinesRemoved).toBe(2);
    expect(vm.contextUsedPercent).toBe(27);
    expect(vm.codexRetainedPayloadBytes).toBe(4_096);
    expect(vm.modelContextWindow).toBe(258_400);
    expect(vm.sessionNum).toBe(9);
    expect(vm.claimedQuestStatus).toBe("done");
    expect(vm.claimedQuestVerificationInboxUnread).toBe(true);
  });

  it("uses configured Codex max context as the effective model context window", () => {
    const sdk = {
      sessionId: "s31",
      state: "connected",
      cwd: "/work",
      createdAt: 1,
      backendType: "codex",
      codexMaxContextLength: 600_000,
      codexTokenDetails,
    } as SdkSessionInfo;

    const vm = toSessionViewModel(sdk);

    expect(vm.modelContextWindow).toBe(600_000);
    expect(vm.codexMaxContextLength).toBe(600_000);
  });

  it("uses live configured max context from SessionState ahead of token metadata", () => {
    const session = {
      session_id: "s32",
      backend_type: "codex",
      model: "gpt-5",
      cwd: "/repo",
      tools: [],
      permissionMode: "codex-default",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      num_turns: 1,
      context_used_percent: 12,
      codex_max_context_length: 750_000,
      codex_token_details: codexTokenDetails,
      is_compacting: false,
      git_branch: "",
      is_worktree: false,
      is_containerized: false,
      repo_root: "/repo",
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    } as SessionState;

    const vm = toSessionViewModel(session);

    expect(vm.modelContextWindow).toBe(750_000);
    expect(vm.codexMaxContextLength).toBe(750_000);
  });
});

describe("coalesceSessionViewModel", () => {
  it("prefers primary values and falls back to secondary", () => {
    const primary = {
      session_id: "s3",
      backend_type: "codex",
      model: "gpt-5",
      cwd: "/repo",
      tools: [],
      permissionMode: "plan",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      user_turn_count: 0,
      agent_turn_count: 0,
      num_turns: 1,
      context_used_percent: 11,
      codex_token_details: codexTokenDetails,
      is_compacting: false,
      git_branch: "feature",
      is_worktree: false,
      is_containerized: false,
      repo_root: "/repo",
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    } as SessionState;

    const fallback = {
      sessionId: "s3",
      state: "running",
      cwd: "/fallback",
      createdAt: 1,
      name: "Fallback Name",
      sessionNum: 42,
    } as SdkSessionInfo;

    const vm = coalesceSessionViewModel(primary, fallback);

    expect(vm?.cwd).toBe("/repo");
    expect(vm?.backendType).toBe("codex");
    expect(vm?.name).toBe("Fallback Name");
    expect(vm?.state).toBe("running");
    expect(vm?.sessionNum).toBe(42);
  });

  it("prefers backend-owned user turn counts over legacy live num_turns", () => {
    // A live session state can briefly carry legacy CLI num_turns while the
    // session-list snapshot already has the backend-owned real user count.
    const primary = {
      session_id: "s3",
      backend_type: "codex",
      model: "gpt-5",
      cwd: "/repo",
      tools: [],
      permissionMode: "plan",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      num_turns: 1,
      context_used_percent: 11,
      is_compacting: false,
      git_branch: "feature",
      is_worktree: false,
      is_containerized: false,
      repo_root: "/repo",
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    } as SessionState;

    const fallback = {
      sessionId: "s3",
      userTurnCount: 12,
      agentTurnCount: 9,
      numTurns: 1,
    } as SdkSessionInfo;

    const vm = coalesceSessionViewModel(primary, fallback);

    expect(vm?.numTurns).toBe(12);
    expect(vm?.userTurnCount).toBe(12);
    expect(vm?.agentTurnCount).toBe(9);
  });

  it("keeps configured max context effective when live token details report the catalog default", () => {
    const primary = {
      session_id: "s31",
      backend_type: "codex",
      model: "gpt-5.5",
      cwd: "/repo",
      tools: [],
      permissionMode: "codex-full-access",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      num_turns: 1,
      context_used_percent: 7,
      codex_token_details: codexTokenDetails,
      is_compacting: false,
      git_branch: "",
      is_worktree: false,
      is_containerized: false,
      repo_root: "/repo",
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    } as SessionState;
    const fallback = {
      sessionId: "s31",
      backendType: "codex",
      codexMaxContextLength: 600_000,
      codexTokenDetails,
    } as SdkSessionInfo;

    const vm = coalesceSessionViewModel(primary, fallback);

    expect(vm?.modelContextWindow).toBe(600_000);
    expect(vm?.codexMaxContextLength).toBe(600_000);
  });

  it("does not fall back to stale sdk max context after a live clear", () => {
    const primary = {
      session_id: "s31",
      backend_type: "codex",
      model: "gpt-5.5",
      cwd: "/repo",
      tools: [],
      permissionMode: "codex-full-access",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      num_turns: 1,
      context_used_percent: 7,
      codex_max_context_length: null,
      codex_token_details: codexTokenDetails,
      is_compacting: false,
      git_branch: "",
      is_worktree: false,
      is_containerized: false,
      repo_root: "/repo",
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    } as SessionState;
    const fallback = {
      sessionId: "s31",
      backendType: "codex",
      codexMaxContextLength: 600_000,
      codexTokenDetails,
    } as SdkSessionInfo;

    const vm = coalesceSessionViewModel(primary, fallback);

    expect(vm?.modelContextWindow).toBe(codexTokenDetails.modelContextWindow);
    expect(vm?.codexMaxContextLength).toBeNull();
  });
});

describe("resolveEffectiveModelContextWindow", () => {
  it("uses backend token details when no max context override is configured", () => {
    expect(
      resolveEffectiveModelContextWindow({
        backendType: "codex",
        codexTokenDetailsModelContextWindow: 258_400,
      }),
    ).toBe(258_400);
  });

  it("keeps configured Claude max context ahead of default token metadata", () => {
    expect(
      resolveEffectiveModelContextWindow({
        backendType: "claude-sdk",
        claudeMaxContextLength: 1_000_000,
        claudeTokenDetailsModelContextWindow: 200_000,
      }),
    ).toBe(1_000_000);
  });
});
