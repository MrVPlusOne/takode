import type { SessionState, CodexModelSwitchCompactionGuard } from "../session-types.js";

const MODEL_SWITCH_COMPACTION_GUARD_TTL_MS = 5 * 60 * 1000;
const MODEL_SWITCH_COMPACTION_SUPPRESSION_THRESHOLD_PERCENT = 90;

type ModelSwitchCompactionSessionLike = {
  state: Pick<SessionState, "codex_token_details" | "context_used_percent">;
  codexModelSwitchCompactionGuard?: CodexModelSwitchCompactionGuard | null;
  codexSuppressRecoveryForCurrentCompaction?: boolean;
};

export function markCodexModelSwitchCompactionGuard(
  session: ModelSwitchCompactionSessionLike,
  options: { previousModel?: string | null; nextModel: string; now?: number },
): void {
  const previousModel = options.previousModel?.trim() || undefined;
  const nextModel = options.nextModel.trim();
  if (!nextModel || previousModel === nextModel) return;
  const now = options.now ?? Date.now();
  session.codexModelSwitchCompactionGuard = {
    ...(previousModel ? { previousModel } : {}),
    nextModel,
    createdAt: now,
    expiresAt: now + MODEL_SWITCH_COMPACTION_GUARD_TTL_MS,
  };
  session.codexSuppressRecoveryForCurrentCompaction = false;
}

export function shouldSuppressCodexModelSwitchCompaction(
  session: ModelSwitchCompactionSessionLike,
  now = Date.now(),
): boolean {
  const guard = session.codexModelSwitchCompactionGuard;
  if (!guard) return false;
  session.codexModelSwitchCompactionGuard = null;
  if (now > guard.expiresAt) return false;

  const percent = currentContextUsedPercent(session.state);
  if (percent === undefined || percent >= MODEL_SWITCH_COMPACTION_SUPPRESSION_THRESHOLD_PERCENT) {
    return false;
  }

  session.codexSuppressRecoveryForCurrentCompaction = true;
  return true;
}

function currentContextUsedPercent(
  state: Pick<SessionState, "codex_token_details" | "context_used_percent">,
): number | undefined {
  if (typeof state.context_used_percent === "number" && Number.isFinite(state.context_used_percent)) {
    return state.context_used_percent;
  }
  const tokens = state.codex_token_details?.contextTokensUsed;
  const window = state.codex_token_details?.modelContextWindow;
  if (
    typeof tokens !== "number" ||
    typeof window !== "number" ||
    !Number.isFinite(tokens) ||
    !Number.isFinite(window) ||
    window <= 0
  ) {
    return undefined;
  }
  return (tokens / window) * 100;
}
