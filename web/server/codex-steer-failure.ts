import type { TurnSteerFailureInfo } from "./bridge/adapter-interface.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractActiveTurnMismatch(error: unknown): { expectedTurnId: string; foundTurnId: string } | null {
  const match = errorMessage(error).match(/expected active turn id [`'"]([^`'"]+)[`'"] but found [`'"]([^`'"]+)[`'"]/);
  if (!match?.[1] || !match[2]) return null;
  return { expectedTurnId: match[1], foundTurnId: match[2] };
}

/**
 * Classifies only the two provider steer failures that Takode can recover
 * without guessing about a different live turn. Every other shape stays
 * visible and follows the ordinary failure path.
 */
export function classifyCodexTurnSteerFailure(
  expectedTurnId: string,
  currentTurnId: string | null,
  error: unknown,
): TurnSteerFailureInfo {
  const mismatch = extractActiveTurnMismatch(error);
  if (
    mismatch?.expectedTurnId === expectedTurnId &&
    mismatch.foundTurnId !== expectedTurnId &&
    (!currentTurnId || currentTurnId === expectedTurnId || currentTurnId === mismatch.foundTurnId)
  ) {
    return {
      kind: "active_turn_mismatch",
      expectedTurnId,
      foundTurnId: mismatch.foundTurnId,
    };
  }

  if (/\bno active turn to steer\b/i.test(errorMessage(error))) {
    if (!currentTurnId || currentTurnId === expectedTurnId) {
      return { kind: "no_active_turn", expectedTurnId };
    }
  }

  return { kind: "other", expectedTurnId };
}
