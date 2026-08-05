import {
  buildCodexGoalSetParams,
  codexGoalCapabilityPatch,
  codexGoalStatePatch,
  isCodexGoalUnsupportedError,
  normalizeCodexGoal,
  type CodexGoalSetInput,
  type CodexGoalSetMode,
  type CodexGoalState,
} from "./codex-goal.js";
import type { SessionState } from "./session-types.js";

type GoalTransport = {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
};

export interface CodexGoalCallResult {
  goal: CodexGoalState | null;
  patch: Partial<SessionState>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeGoalResult(result: unknown): CodexGoalState | null {
  return normalizeCodexGoal((result as { goal?: unknown })?.goal ?? result);
}

export async function refreshCodexGoal(transport: GoalTransport, threadId: string): Promise<CodexGoalCallResult> {
  try {
    const goal = normalizeGoalResult(await transport.call("thread/goal/get", { threadId }, 5_000));
    return { goal, patch: { ...codexGoalStatePatch(goal), ...codexGoalCapabilityPatch("supported") } };
  } catch (error) {
    if (!isCodexGoalUnsupportedError(error)) {
      return {
        goal: null,
        patch: { ...codexGoalCapabilityPatch("error", errorMessage(error)) },
      };
    }
    return {
      goal: null,
      patch: { ...codexGoalStatePatch(null), ...codexGoalCapabilityPatch("unsupported", errorMessage(error)) },
    };
  }
}

export async function setCodexGoal(
  transport: GoalTransport,
  threadId: string,
  input: CodexGoalSetInput,
  mode: CodexGoalSetMode,
): Promise<CodexGoalCallResult> {
  if (mode === "replace") await transport.call("thread/goal/clear", { threadId }, 5_000);
  const goal = normalizeGoalResult(
    await transport.call("thread/goal/set", buildCodexGoalSetParams(threadId, input), 5_000),
  );
  return { goal, patch: { ...codexGoalStatePatch(goal), ...codexGoalCapabilityPatch("supported") } };
}

export async function clearCodexGoal(transport: GoalTransport, threadId: string): Promise<Partial<SessionState>> {
  await transport.call("thread/goal/clear", { threadId }, 5_000);
  return { ...codexGoalStatePatch(null), ...codexGoalCapabilityPatch("supported") };
}
