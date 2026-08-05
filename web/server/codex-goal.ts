import type { SessionState } from "./session-types.js";

export type CodexGoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";

export type CodexGoalSupportState = "unknown" | "supported" | "unsupported" | "error";

export interface CodexGoalState {
  threadId: string;
  objective: string;
  status: CodexGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string | null;
  updatedAt: string | null;
  activeTurnId?: string | null;
}

export interface CodexGoalCapabilityState {
  state: CodexGoalSupportState;
  checkedAt: number | null;
  error: string | null;
}

export interface CodexGoalSetInput {
  objective?: string | null;
  status?: CodexGoalStatus;
  tokenBudget?: number | null;
}

export type CodexGoalSetMode = "edit" | "replace";

export const CODEX_GOAL_UNKNOWN_CAPABILITY: CodexGoalCapabilityState = {
  state: "unknown",
  checkedAt: null,
  error: null,
};

const STATUS_FROM_WIRE: Record<string, CodexGoalStatus> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usage_limited: "usage_limited",
  usageLimited: "usage_limited",
  budget_limited: "budget_limited",
  budgetLimited: "budget_limited",
  complete: "complete",
};

const STATUS_TO_WIRE: Record<CodexGoalStatus, string> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usage_limited: "usageLimited",
  budget_limited: "budgetLimited",
  complete: "complete",
};

export function normalizeCodexGoalStatus(value: unknown): CodexGoalStatus | null {
  if (typeof value !== "string") return null;
  return STATUS_FROM_WIRE[value] ?? null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeCodexGoal(value: unknown): CodexGoalState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const threadId = nullableString(raw.threadId);
  const objective = nullableString(raw.objective);
  const status = normalizeCodexGoalStatus(raw.status);
  if (!threadId || !objective || !status) return null;
  return {
    threadId,
    objective,
    status,
    tokenBudget: nullableNumber(raw.tokenBudget),
    tokensUsed: nullableNumber(raw.tokensUsed) ?? 0,
    timeUsedSeconds: nullableNumber(raw.timeUsedSeconds) ?? 0,
    createdAt: nullableString(raw.createdAt),
    updatedAt: nullableString(raw.updatedAt),
  };
}

export function buildCodexGoalSetParams(threadId: string, input: CodexGoalSetInput): Record<string, unknown> {
  const params: Record<string, unknown> = { threadId };
  if ("objective" in input) params.objective = input.objective;
  if (input.status) params.status = STATUS_TO_WIRE[input.status];
  if ("tokenBudget" in input) params.tokenBudget = input.tokenBudget;
  return params;
}

export function isCodexGoalUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\bmethod not found\b/i.test(message) ||
    /\bunknown method\b/i.test(message) ||
    /\bfeatures?\.goals?\b.*\bdisabled\b/i.test(message) ||
    /\bgoals?\b.*\bdisabled\b/i.test(message) ||
    /\bunmaterialized\b/i.test(message) ||
    /\bephemeral\b/i.test(message)
  );
}

export function codexGoalCapabilityPatch(
  state: CodexGoalSupportState,
  error: string | null = null,
): Pick<SessionState, "codex_goal_capability"> {
  return {
    codex_goal_capability: {
      state,
      checkedAt: Date.now(),
      error,
    },
  };
}

export function codexGoalStatePatch(goal: CodexGoalState | null): Pick<SessionState, "codex_goal"> {
  return { codex_goal: goal };
}
