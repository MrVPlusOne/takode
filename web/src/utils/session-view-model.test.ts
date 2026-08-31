import { describe, expect, it } from "vitest";
import type { SdkSessionInfo } from "../types.js";
import { toSessionViewModel } from "./session-view-model.js";

const codexTokenDetails = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
  contextTokensUsed: 99_000,
  modelContextWindow: 258_400,
};

function makeSession(overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/work",
    createdAt: 1,
    backendType: "codex",
    ...overrides,
  };
}

describe("toSessionViewModel", () => {
  it("maps the current session-list field shape directly", () => {
    const vm = toSessionViewModel(
      makeSession({
        model: "gpt-5",
        permissionMode: "codex-full-access",
        repoRoot: "/repo",
        gitBranch: "jiayi",
        gitDefaultBranch: "main",
        diffBaseBranch: "main",
        isWorktree: true,
        gitAhead: 2,
        gitBehind: 1,
        totalLinesAdded: 10,
        totalLinesRemoved: 4,
        contextUsedPercent: 42,
        contextTokensUsed: 54_000,
        modelContextWindow: 128_000,
        codexMaxContextLength: 600_000,
        messageHistoryBytes: 2_048,
        codexRetainedPayloadBytes: 4_096,
        userTurnCount: 3,
        agentTurnCount: 2,
        sessionNum: 9,
        name: "Test",
        claimedQuestStatus: "done",
        claimedQuestVerificationInboxUnread: true,
        askPermission: true,
      }),
    );

    expect(vm).toMatchObject({
      sessionId: "s1",
      backendType: "codex",
      model: "gpt-5",
      permissionMode: "codex-full-access",
      gitBranch: "jiayi",
      repoRoot: "/repo",
      isWorktree: true,
      totalLinesAdded: 10,
      totalLinesRemoved: 4,
      contextUsedPercent: 42,
      contextTokensUsed: 54_000,
      modelContextWindow: 128_000,
      backendReportedContextWindow: 128_000,
      codexMaxContextLength: 600_000,
      messageHistoryBytes: 2_048,
      codexRetainedPayloadBytes: 4_096,
      numTurns: 3,
      userTurnCount: 3,
      agentTurnCount: 2,
      sessionNum: 9,
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
      askPermission: true,
    });
  });

  it("does not revive removed projection values from legacy token-detail fields", () => {
    const vm = toSessionViewModel(
      makeSession({
        codexMaxContextLength: null,
        codexReasoningEffort: null,
        codexEffectiveReasoningEffort: null,
        codexTokenDetails,
      }),
    );

    expect(vm.modelContextWindow).toBeUndefined();
    expect(vm.contextTokensUsed).toBeUndefined();
    expect(vm.backendReportedContextWindow).toBeUndefined();
    expect(vm.codexMaxContextLength).toBeNull();
    expect(vm.codexReasoningEffort).toBeNull();
    expect(vm.codexEffectiveReasoningEffort).toBeNull();
  });

  it("uses the backend-owned user count for the visible turn total", () => {
    const vm = toSessionViewModel(makeSession({ userTurnCount: 12, agentTurnCount: 9, numTurns: 1 }));

    expect(vm.numTurns).toBe(12);
    expect(vm.userTurnCount).toBe(12);
    expect(vm.agentTurnCount).toBe(9);
  });

  it("derives the paused queue count only within the authoritative session row", () => {
    const vm = toSessionViewModel(
      makeSession({
        pause: {
          pausedAt: 1,
          reason: "Manual pause",
          queuedMessages: [
            { id: "queued-1", queuedAt: 2, source: "browser", message: { type: "user_message", content: "Continue" } },
          ],
        },
      }),
    );

    expect(vm.pausedInputQueueCount).toBe(1);
  });
});
