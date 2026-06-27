import type { CompanionSettings } from "./settings-manager.js";
import type { BackendType } from "./session-types.js";
import {
  CLAUDE_1M_CONTEXT_TOKENS,
  CODEX_REASONING_EFFORTS,
  CLAUDE_REASONING_EFFORTS,
  DEFAULT_SESSION_DEFAULTS,
  isSupportedClaudeDefaultMaxContext,
} from "../shared/session-defaults.js";

export class SessionDefaultValidationError extends Error {}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function normalizeMaxContext(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isPositiveInteger(value)) throw new SessionDefaultValidationError(`${field} must be a positive integer`);
  return value;
}

function requireAllowed(value: unknown, allowed: readonly string[], field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value.trim())) {
    throw new SessionDefaultValidationError(`${field} is not supported`);
  }
  return value.trim();
}

export function applySessionDefaultsToCreateBody<T extends Record<string, unknown>>(
  body: T,
  backend: BackendType,
  settings: CompanionSettings,
): T {
  const sessionDefaults = settings.sessionDefaults ?? DEFAULT_SESSION_DEFAULTS;
  const next: Record<string, unknown> = { ...body };

  if (backend === "codex") {
    const defaults = sessionDefaults.codex;
    if (next.model === undefined && defaults.model) next.model = defaults.model;
    if (next.codexInternetAccess === undefined) next.codexInternetAccess = defaults.internetAccess;
    if (next.codexReasoningEffort === undefined && defaults.reasoningEffort) {
      next.codexReasoningEffort = defaults.reasoningEffort;
    }
    if (next.codexServiceTier === undefined) next.codexServiceTier = defaults.serviceTier;
    if (next.codexMaxContextLength === undefined && defaults.maxContextLength) {
      next.codexMaxContextLength = defaults.maxContextLength;
    }
  } else {
    const defaults = sessionDefaults.claude;
    if (next.model === undefined && defaults.model) next.model = defaults.model;
    if (next.permissionMode === undefined && defaults.permissionMode) next.permissionMode = defaults.permissionMode;
    if (next.claudeReasoningEffort === undefined && defaults.reasoningEffort) {
      next.claudeReasoningEffort = defaults.reasoningEffort;
    }
    if (next.claudeMaxContextLength === undefined && defaults.maxContextLength) {
      next.claudeMaxContextLength = defaults.maxContextLength;
    }
  }

  return validateSessionCreateDefaults(next as T, backend);
}

export function validateSessionCreateDefaults<T extends Record<string, unknown>>(body: T, backend: BackendType): T {
  const codexReasoning = requireAllowed(body.codexReasoningEffort, CODEX_REASONING_EFFORTS, "codexReasoningEffort");
  const claudeReasoning = requireAllowed(body.claudeReasoningEffort, CLAUDE_REASONING_EFFORTS, "claudeReasoningEffort");
  const codexMaxContext = normalizeMaxContext(body.codexMaxContextLength, "codexMaxContextLength");
  const claudeMaxContext = normalizeMaxContext(body.claudeMaxContextLength, "claudeMaxContextLength");

  if (backend === "codex" && claudeReasoning) {
    throw new SessionDefaultValidationError("claudeReasoningEffort is only supported for Claude sessions");
  }
  if (backend !== "codex" && codexReasoning) {
    throw new SessionDefaultValidationError("codexReasoningEffort is only supported for Codex sessions");
  }
  if (backend !== "codex" && !isSupportedClaudeDefaultMaxContext(claudeMaxContext ?? null)) {
    throw new SessionDefaultValidationError(
      `claudeMaxContextLength currently supports only ${CLAUDE_1M_CONTEXT_TOKENS} or empty`,
    );
  }

  return {
    ...body,
    ...(codexReasoning ? { codexReasoningEffort: codexReasoning } : {}),
    ...(claudeReasoning ? { claudeReasoningEffort: claudeReasoning } : {}),
    ...(codexMaxContext ? { codexMaxContextLength: codexMaxContext } : {}),
    ...(claudeMaxContext ? { claudeMaxContextLength: claudeMaxContext } : {}),
  };
}
