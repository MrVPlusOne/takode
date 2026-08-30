import type { CodexModelSwitchCompactionGuard } from "../session-types.js";

const MODEL_SWITCH_COMPACTION_GUARD_TTL_MS = 5 * 60 * 1000;

type ModelSwitchCompactionSessionLike = {
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
    modelActivityObserved: false,
  };
  session.codexSuppressRecoveryForCurrentCompaction = false;
}

export function markCodexModelSwitchActivity(session: ModelSwitchCompactionSessionLike, now = Date.now()): boolean {
  const guard = session.codexModelSwitchCompactionGuard;
  if (!guard) return false;
  if (now > guard.expiresAt) {
    session.codexModelSwitchCompactionGuard = null;
    return false;
  }
  if (guard.modelActivityObserved) return false;
  guard.modelActivityObserved = true;
  return true;
}

export function discardCodexModelSwitchCompactionGuard(session: ModelSwitchCompactionSessionLike): boolean {
  if (!session.codexModelSwitchCompactionGuard) return false;
  session.codexModelSwitchCompactionGuard = null;
  return true;
}

export function shouldSuppressCodexModelSwitchCompaction(
  session: ModelSwitchCompactionSessionLike,
  now = Date.now(),
): boolean {
  const guard = session.codexModelSwitchCompactionGuard;
  if (!guard) return false;
  session.codexModelSwitchCompactionGuard = null;
  if (now > guard.expiresAt) return false;
  if (guard.modelActivityObserved) return false;

  session.codexSuppressRecoveryForCurrentCompaction = true;
  return true;
}
