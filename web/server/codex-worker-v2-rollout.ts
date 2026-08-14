import type { CodexMultiAgentVersion as CodexSelectedMultiAgentVersion } from "../shared/codex-multi-agent-version.js";
import {
  buildCodexWorkerFreshThreadHandoff,
  type CodexWorkerFreshThreadHandoffBundle,
  type CodexWorkerFreshThreadHandoffInput,
  type CodexWorkerFreshThreadHandoffLimits,
} from "./codex-worker-v2-handoff.js";

export type CodexEffectiveMultiAgentVersion = CodexSelectedMultiAgentVersion | "disabled";

export interface CodexWorkerRoleCandidate {
  backendType?: string;
  archived?: boolean;
  isOrchestrator?: boolean;
  reviewerOf?: number | null;
  hidden?: boolean;
  publicSessionNumber?: boolean;
  herdedBy?: string | null;
}

export interface CodexWorkerV2RolloutSession extends CodexWorkerRoleCandidate {
  sessionId: string;
  sessionNum?: number | null;
  name?: string | null;
  state?: "starting" | "connected" | "running" | "exited" | string;
  selectedMultiAgentVersion?: CodexSelectedMultiAgentVersion | null;
  workerV2CutoverState?:
    | "prepared"
    | "staged"
    | "activating"
    | "awaiting_effective"
    | "rolling_back"
    | "awaiting_rollback_effective"
    | "rolled_back"
    | "rollback_failed"
    | null;
}

export interface CodexWorkerV2RuntimeSnapshot {
  backendState?:
    | "initializing"
    | "resuming"
    | "recovering"
    | "connected"
    | "disconnected"
    | "recovery_suppressed"
    | "broken"
    | null;
  backendAttached: boolean;
  backendConnected: boolean;
  isGenerating: boolean;
  hasActiveTurn: boolean;
  interruptedDuringTurn: boolean;
  paused: boolean;
  relaunchPending?: boolean;
  pendingPermissionCount: number;
  effectiveMultiAgentVersion?: CodexEffectiveMultiAgentVersion | null;
}

export interface CodexWorkerRolloutPreservedItem {
  id: string;
  fingerprint: string;
}

/**
 * Opaque integration-owned fingerprints make the controller verify that the
 * cutover did not rewrite Takode history, queued delivery, launch settings,
 * quest ownership, or worktree identity. New history/queue entries are allowed;
 * pre-cutover entries must remain unchanged and in order. Integration fingerprints
 * must exclude the intentionally changed selected version, backend thread id, and
 * one-shot handoff state.
 */
export interface CodexWorkerRolloutPreservationSnapshot {
  history: readonly CodexWorkerRolloutPreservedItem[];
  pendingInputs: readonly CodexWorkerRolloutPreservedItem[];
  pendingTurns: readonly CodexWorkerRolloutPreservedItem[];
  launchConfigFingerprint: string;
  questFingerprint: string;
  worktreeFingerprint: string;
  recoveryFingerprint: string;
  sessionIdentityFingerprint: string;
}

export interface CodexWorkerPreparedV2Cutover {
  sessionId: string;
  cutoverId: string;
  activation: "now" | "next_resume";
  /** Integration-owned handle for restoring the original V1 thread atomically. */
  opaque: unknown;
}

/**
 * Suggested compact launcher-persisted state. Confirmed V2 cutovers remove this
 * object; awaiting-effective state retains the original V1 thread until a real
 * turn proves V2. The bridge's full history and queues remain in their existing
 * authoritative stores rather than being copied here.
 */
export interface CodexWorkerV2DurableCutoverState {
  schemaVersion: 1;
  cutoverId: string;
  status:
    | "prepared"
    | "staged"
    | "activating"
    | "awaiting_effective"
    | "rolling_back"
    | "awaiting_rollback_effective"
    | "rolled_back"
    | "rollback_failed";
  requestedAt: number;
  updatedAt: number;
  activation: "now" | "next_resume";
  targetVersion: "v2";
  rollbackVersion: "v1";
  originalCliSessionId: string | null;
  replacementCliSessionId?: string | null;
  rollbackCliSessionId?: string | null;
  originalSelectedVersion?: CodexSelectedMultiAgentVersion | null;
  /** Cleared only after the replacement adapter emits session_meta. */
  oneShotExtraInstructions?: string | null;
  handoffFingerprint: string;
  preservation: {
    historyCount: number;
    historyPrefixFingerprint: string;
    pendingInputs: readonly CodexWorkerRolloutPreservedItem[];
    pendingTurns: readonly CodexWorkerRolloutPreservedItem[];
    pendingInputFingerprint: string;
    pendingTurnFingerprint: string;
    launchConfigFingerprint: string;
    questFingerprint: string;
    worktreeFingerprint: string;
    recoveryFingerprint: string;
    sessionIdentityFingerprint: string;
  };
  sessionMetaObservedAt?: number | null;
  preservationVerifiedAt?: number | null;
  rollbackSessionMetaObservedAt?: number | null;
  effectiveVersion?: CodexEffectiveMultiAgentVersion | null;
  lastFailure?: {
    reason: string;
    detail?: string;
    observedAt: number;
  } | null;
}

export interface CodexWorkerEffectiveVersionObservation {
  version: CodexEffectiveMultiAgentVersion | null;
  detail?: string;
  /** Graceful server shutdown left the durable cutover pending for restart recovery. */
  aborted?: boolean;
}

export interface CodexWorkerV2RollbackResult {
  ok: boolean;
  effectiveVersion?: CodexEffectiveMultiAgentVersion | null;
  awaitingFirstTurn?: boolean;
  error?: string;
}

export interface CodexWorkerV2RolloutDeps {
  listSessions: () => readonly CodexWorkerV2RolloutSession[] | Promise<readonly CodexWorkerV2RolloutSession[]>;
  getRuntimeSnapshot: (
    sessionId: string,
  ) => CodexWorkerV2RuntimeSnapshot | null | Promise<CodexWorkerV2RuntimeSnapshot | null>;
  getHandoffInput: (
    session: CodexWorkerV2RolloutSession,
    cutoverId: string,
    generatedAt: number,
  ) =>
    | Omit<CodexWorkerFreshThreadHandoffInput, "cutoverId" | "generatedAt" | "sessionId" | "sessionNum" | "sessionName">
    | Promise<
        Omit<
          CodexWorkerFreshThreadHandoffInput,
          "cutoverId" | "generatedAt" | "sessionId" | "sessionNum" | "sessionName"
        >
      >;
  capturePreservationSnapshot: (
    sessionId: string,
  ) => CodexWorkerRolloutPreservationSnapshot | Promise<CodexWorkerRolloutPreservationSnapshot>;
  /** Atomically freeze model-bound delivery, then report whether the worker is still idle. */
  freezeModelBoundDelivery: (sessionId: string, cutoverId: string) => boolean | Promise<boolean>;
  /** Release a previously acquired delivery freeze. Idempotent. */
  releaseModelBoundDelivery: (sessionId: string, cutoverId: string) => void | Promise<void>;
  /**
   * Must freeze model-bound delivery, preserve new inbound inputs in the same
   * queues, persist selected V2, clear only the backend thread-resume identity,
   * and store the handoff as one-shot launch extraInstructions. It must not append
   * a synthetic model turn or alter Takode-owned history/queue entries. The hook
   * must be atomic: if it throws, it must leave no partial migration state.
   */
  prepareFreshThreadCutover: (args: {
    session: CodexWorkerV2RolloutSession;
    cutoverId: string;
    activation: "now" | "next_resume";
    targetVersion: "v2";
    rollbackVersion: "v1";
    handoff: CodexWorkerFreshThreadHandoffBundle;
    preservationBaseline: CodexWorkerRolloutPreservationSnapshot;
  }) => CodexWorkerPreparedV2Cutover | Promise<CodexWorkerPreparedV2Cutover>;
  /** Persist a disconnected/exited cutover for activation on its next legitimate resume. */
  stageFreshThreadCutover: (prepared: CodexWorkerPreparedV2Cutover) => void | Promise<void>;
  /** Recover durable rollback provenance for a cutover awaiting its first real turn. */
  getPreparedFreshThreadCutover: (
    session: CodexWorkerV2RolloutSession,
  ) => CodexWorkerPreparedV2Cutover | null | Promise<CodexWorkerPreparedV2Cutover | null>;
  /** Relaunch an already-prepared connected/idle worker into a fresh backend thread. */
  relaunchFreshThread: (
    prepared: CodexWorkerPreparedV2Cutover,
  ) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
  /** Resolve after the replacement adapter emits session_meta; null is valid until its first real turn_context. */
  waitForEffectiveVersion: (args: {
    prepared: CodexWorkerPreparedV2Cutover;
    expected: CodexSelectedMultiAgentVersion;
  }) => CodexWorkerEffectiveVersionObservation | Promise<CodexWorkerEffectiveVersionObservation>;
  /**
   * Clear the one-shot launcher handoff only after the fresh adapter emits the
   * new session_meta. `awaiting_first_turn` must retain V1 rollback provenance;
   * preserved pending inputs may resume without manufacturing a proof turn.
   */
  commitFreshThreadCutover: (
    prepared: CodexWorkerPreparedV2Cutover,
    verification: "confirmed_v2" | "awaiting_first_turn",
  ) => void | Promise<void>;
  /** Restore selected V1 plus the original thread identity and queues. */
  rollbackFreshThreadCutover: (args: {
    prepared: CodexWorkerPreparedV2Cutover;
    reason:
      | "became_active"
      | "preservation_mismatch"
      | "relaunch_failed"
      | "effective_version_mismatch"
      | "verification_failed"
      | "commit_failed";
    targetVersion: "v1";
    requireRelaunch: boolean;
  }) => CodexWorkerV2RollbackResult | Promise<CodexWorkerV2RollbackResult>;
  now?: () => number;
}

export interface CodexWorkerV2RolloutOptions {
  /** Eligible ordinary workers processed in one run. Excluded sessions do not consume the bound. */
  maxSessions?: number;
  handoffLimits?: CodexWorkerFreshThreadHandoffLimits;
}

export type CodexWorkerV2RolloutAction =
  | "migrated"
  | "staged"
  | "unchanged"
  | "awaiting_effective"
  | "deferred"
  | "skipped"
  | "rolled_back"
  | "rollback_failed"
  | "failed";

export type CodexWorkerV2RolloutReason =
  | "effective_v2"
  | "explicit_v1"
  | "selected_v2_awaiting_first_turn"
  | "cutover_already_pending"
  | "not_codex"
  | "archived"
  | "leader"
  | "reviewer"
  | "hidden"
  | "not_worker"
  | "batch_limit"
  | "rollout_halted"
  | "interrupted_turn"
  | "active_turn"
  | "paused"
  | "pending_permission"
  | "initializing"
  | "backend_unhealthy"
  | "prepared_for_next_resume"
  | "cutover_complete"
  | "awaiting_first_turn"
  | "became_active"
  | "preservation_mismatch"
  | "relaunch_failed"
  | "effective_version_mismatch"
  | "verification_failed"
  | "commit_failed"
  | "prepare_failed";

export interface CodexWorkerV2RolloutSessionResult {
  sessionId: string;
  action: CodexWorkerV2RolloutAction;
  reason: CodexWorkerV2RolloutReason;
  cutoverId?: string;
  detail?: string;
  effectiveVersion?: CodexEffectiveMultiAgentVersion | null;
  preservationDifferences?: string[];
}

export interface CodexWorkerV2RolloutResult {
  results: CodexWorkerV2RolloutSessionResult[];
  eligibleSessions: number;
  processedEligibleSessions: number;
  remainingEligibleSessions: number;
  halted: boolean;
}

const DEFAULT_MAX_SESSIONS_PER_RUN = 10;
const MAX_SESSIONS_PER_RUN = 100;

export function isOrdinaryCodexWorker(session: CodexWorkerRoleCandidate): boolean {
  return ordinaryCodexWorkerExclusionReason(session) === null;
}

export function ordinaryCodexWorkerExclusionReason(
  session: CodexWorkerRoleCandidate,
): Extract<
  CodexWorkerV2RolloutReason,
  "not_codex" | "archived" | "leader" | "reviewer" | "hidden" | "not_worker"
> | null {
  if (session.backendType !== "codex") return "not_codex";
  if (session.archived === true) return "archived";
  if (session.isOrchestrator === true) return "leader";
  if (typeof session.reviewerOf === "number") return "reviewer";
  if (session.hidden === true || session.publicSessionNumber === false) return "hidden";
  if (typeof session.herdedBy !== "string" || !session.herdedBy.trim()) return "not_worker";
  return null;
}

export function compareCodexWorkerRolloutPreservation(
  baseline: CodexWorkerRolloutPreservationSnapshot,
  current: CodexWorkerRolloutPreservationSnapshot,
): string[] {
  const differences: string[] = [];
  if (!isExactPrefix(baseline.history, current.history)) differences.push("history_changed_or_removed");
  if (!isOrderedSubsequence(baseline.pendingInputs, current.pendingInputs))
    differences.push("pending_inputs_changed_or_removed");
  if (!isOrderedSubsequence(baseline.pendingTurns, current.pendingTurns))
    differences.push("pending_turns_changed_or_removed");
  if (baseline.launchConfigFingerprint !== current.launchConfigFingerprint) differences.push("launch_config_changed");
  if (baseline.questFingerprint !== current.questFingerprint) differences.push("quest_identity_changed");
  if (baseline.worktreeFingerprint !== current.worktreeFingerprint) differences.push("worktree_identity_changed");
  if (baseline.recoveryFingerprint !== current.recoveryFingerprint) differences.push("recovery_state_changed");
  if (baseline.sessionIdentityFingerprint !== current.sessionIdentityFingerprint)
    differences.push("session_identity_changed");
  return differences;
}

export async function runCodexWorkerV2Rollout(
  deps: CodexWorkerV2RolloutDeps,
  options: CodexWorkerV2RolloutOptions = {},
): Promise<CodexWorkerV2RolloutResult> {
  const sessions = [...(await deps.listSessions())];
  const maxSessions = normalizeMaxSessions(options.maxSessions);
  const results: CodexWorkerV2RolloutSessionResult[] = [];
  const eligible = sessions.filter(isOrdinaryCodexWorker);
  let processedEligibleSessions = 0;
  let halted = false;

  for (const session of sessions) {
    const exclusion = ordinaryCodexWorkerExclusionReason(session);
    if (exclusion) {
      results.push({ sessionId: session.sessionId, action: "skipped", reason: exclusion });
      continue;
    }
    if (halted) {
      results.push({ sessionId: session.sessionId, action: "deferred", reason: "rollout_halted" });
      continue;
    }
    if (processedEligibleSessions >= maxSessions) {
      results.push({ sessionId: session.sessionId, action: "deferred", reason: "batch_limit" });
      continue;
    }

    processedEligibleSessions += 1;
    const outcome = await processOrdinaryCodexWorker(session, deps, options.handoffLimits);
    results.push(outcome.result);
    halted = outcome.halt;
  }

  return {
    results,
    eligibleSessions: eligible.length,
    processedEligibleSessions,
    remainingEligibleSessions: Math.max(0, eligible.length - processedEligibleSessions),
    halted,
  };
}

async function processOrdinaryCodexWorker(
  session: CodexWorkerV2RolloutSession,
  deps: CodexWorkerV2RolloutDeps,
  handoffLimits?: CodexWorkerFreshThreadHandoffLimits,
): Promise<{ result: CodexWorkerV2RolloutSessionResult; halt: boolean }> {
  const runtime = await deps.getRuntimeSnapshot(session.sessionId);
  if (session.workerV2CutoverState === "awaiting_rollback_effective") {
    return {
      result: {
        sessionId: session.sessionId,
        action: "awaiting_effective",
        reason: "awaiting_first_turn",
        detail: "fresh V1 rollback thread is awaiting its first retained turn_context",
        effectiveVersion: null,
      },
      halt: true,
    };
  }
  if (
    session.workerV2CutoverState === "rolling_back" ||
    session.workerV2CutoverState === "rolled_back" ||
    session.workerV2CutoverState === "rollback_failed"
  ) {
    return {
      result: {
        sessionId: session.sessionId,
        action:
          session.workerV2CutoverState === "rollback_failed"
            ? "rollback_failed"
            : session.workerV2CutoverState === "rolled_back"
              ? "rolled_back"
              : "deferred",
        reason: "rollout_halted",
        detail: `durable worker cutover state is ${session.workerV2CutoverState}`,
      },
      halt: true,
    };
  }
  if (session.selectedMultiAgentVersion === "v1") {
    return {
      result: { sessionId: session.sessionId, action: "unchanged", reason: "explicit_v1" },
      halt: false,
    };
  }
  if (session.workerV2CutoverState === "awaiting_effective") {
    return reconcileAwaitingEffectiveCutover(session, runtime, deps);
  }
  if (runtime?.effectiveMultiAgentVersion === "v2") {
    return {
      result: {
        sessionId: session.sessionId,
        action: "unchanged",
        reason: "effective_v2",
        effectiveVersion: "v2",
      },
      halt: false,
    };
  }
  if (session.selectedMultiAgentVersion === "v2" && runtime?.effectiveMultiAgentVersion == null) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "awaiting_effective",
        reason: "selected_v2_awaiting_first_turn",
        effectiveVersion: null,
      },
      halt: false,
    };
  }
  if (
    session.workerV2CutoverState === "prepared" ||
    session.workerV2CutoverState === "staged" ||
    session.workerV2CutoverState === "activating"
  ) {
    return {
      result: { sessionId: session.sessionId, action: "unchanged", reason: "cutover_already_pending" },
      halt: false,
    };
  }

  const readiness = rolloutReadiness(session, runtime);
  if (readiness.deferReason) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "deferred",
        reason: readiness.deferReason,
      },
      halt: false,
    };
  }

  const generatedAt = deps.now?.() ?? Date.now();
  const cutoverId = `worker-v2-cutover-${generatedAt}-${session.sessionId.slice(0, 8)}`;
  let deliveryFrozen = false;
  try {
    deliveryFrozen = await deps.freezeModelBoundDelivery(session.sessionId, cutoverId);
  } catch (error) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "failed",
        reason: "prepare_failed",
        cutoverId,
        detail: errorMessage(error),
      },
      halt: true,
    };
  }
  if (!deliveryFrozen) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "deferred",
        reason: "became_active",
        cutoverId,
        detail: "worker was no longer idle when model-bound delivery was frozen",
      },
      halt: false,
    };
  }

  const runtimeAfterFreeze = await deps.getRuntimeSnapshot(session.sessionId);
  const frozenReadiness = rolloutReadiness(session, runtimeAfterFreeze);
  if (frozenReadiness.deferReason || frozenReadiness.activation !== readiness.activation) {
    await deps.releaseModelBoundDelivery(session.sessionId, cutoverId);
    return {
      result: {
        sessionId: session.sessionId,
        action: "deferred",
        reason: "became_active",
        cutoverId,
        detail: frozenReadiness.deferReason ?? "backend activation changed while delivery was freezing",
      },
      halt: false,
    };
  }

  let baseline: CodexWorkerRolloutPreservationSnapshot;
  let prepared: CodexWorkerPreparedV2Cutover;
  try {
    baseline = await deps.capturePreservationSnapshot(session.sessionId);
    const handoffState = await deps.getHandoffInput(session, cutoverId, generatedAt);
    const handoff = buildCodexWorkerFreshThreadHandoff(
      {
        ...handoffState,
        cutoverId,
        generatedAt,
        sessionId: session.sessionId,
        sessionNum: session.sessionNum,
        sessionName: session.name,
      },
      handoffLimits,
    );
    prepared = await deps.prepareFreshThreadCutover({
      session,
      cutoverId,
      activation: readiness.activation,
      targetVersion: "v2",
      rollbackVersion: "v1",
      handoff,
      preservationBaseline: baseline,
    });
  } catch (error) {
    await deps.releaseModelBoundDelivery(session.sessionId, cutoverId);
    return {
      result: {
        sessionId: session.sessionId,
        action: "failed",
        reason: "prepare_failed",
        cutoverId,
        detail: errorMessage(error),
      },
      halt: true,
    };
  }

  const preparedVerification = await verifyPreservation(session.sessionId, baseline, deps);
  if (preparedVerification.length > 0) {
    return rollbackAfterFailure(session.sessionId, prepared, preservationFailureReason(preparedVerification), deps, {
      cutoverId,
      detail: preparedVerification.join(", "),
      preservationDifferences: preparedVerification,
      requireRelaunch: false,
    });
  }

  if (readiness.activation === "next_resume") {
    try {
      await deps.stageFreshThreadCutover(prepared);
      return {
        result: {
          sessionId: session.sessionId,
          action: "staged",
          reason: "prepared_for_next_resume",
          cutoverId,
        },
        halt: false,
      };
    } catch (error) {
      return rollbackAfterFailure(session.sessionId, prepared, "commit_failed", deps, {
        cutoverId,
        detail: errorMessage(error),
        requireRelaunch: false,
      });
    }
  }

  const runtimeBeforeRelaunch = await deps.getRuntimeSnapshot(session.sessionId);
  const racedReadiness = rolloutReadiness(session, runtimeBeforeRelaunch);
  if (racedReadiness.deferReason || racedReadiness.activation !== "now") {
    return rollbackAfterFailure(session.sessionId, prepared, "became_active", deps, {
      cutoverId,
      detail: racedReadiness.deferReason ?? "backend no longer connected and idle",
      requireRelaunch: false,
      deferredAfterRollback: true,
    });
  }

  let relaunch: { ok: boolean; error?: string };
  try {
    relaunch = await deps.relaunchFreshThread(prepared);
  } catch (error) {
    relaunch = { ok: false, error: errorMessage(error) };
  }
  if (!relaunch.ok) {
    return rollbackAfterFailure(session.sessionId, prepared, "relaunch_failed", deps, {
      cutoverId,
      detail: relaunch.error,
      requireRelaunch: true,
    });
  }

  let effective: CodexWorkerEffectiveVersionObservation;
  try {
    effective = await deps.waitForEffectiveVersion({ prepared, expected: "v2" });
  } catch (error) {
    return rollbackAfterFailure(session.sessionId, prepared, "verification_failed", deps, {
      cutoverId,
      detail: errorMessage(error),
      requireRelaunch: true,
    });
  }
  if (effective.aborted) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "deferred",
        reason: "initializing",
        cutoverId,
        detail: effective.detail ?? "server shutdown left the durable cutover pending for restart recovery",
        effectiveVersion: null,
      },
      halt: false,
    };
  }
  if (effective.version !== null && effective.version !== "v2") {
    return rollbackAfterFailure(session.sessionId, prepared, "effective_version_mismatch", deps, {
      cutoverId,
      detail: effective.detail ?? `effective version was ${effective.version}`,
      effectiveVersion: effective.version,
      requireRelaunch: true,
    });
  }

  await deps.releaseModelBoundDelivery(session.sessionId, cutoverId);
  const verification = effective.version === "v2" ? "confirmed_v2" : "awaiting_first_turn";
  try {
    await deps.commitFreshThreadCutover(prepared, verification);
  } catch (error) {
    return rollbackAfterFailure(session.sessionId, prepared, "commit_failed", deps, {
      cutoverId,
      detail: errorMessage(error),
      effectiveVersion: effective.version,
      requireRelaunch: true,
    });
  }

  if (verification === "awaiting_first_turn") {
    return {
      result: {
        sessionId: session.sessionId,
        action: "awaiting_effective",
        reason: "awaiting_first_turn",
        cutoverId,
        detail: effective.detail,
        effectiveVersion: null,
      },
      halt: false,
    };
  }

  return {
    result: {
      sessionId: session.sessionId,
      action: "migrated",
      reason: "cutover_complete",
      cutoverId,
      effectiveVersion: "v2",
    },
    halt: false,
  };
}

async function reconcileAwaitingEffectiveCutover(
  session: CodexWorkerV2RolloutSession,
  runtime: CodexWorkerV2RuntimeSnapshot | null,
  deps: CodexWorkerV2RolloutDeps,
): Promise<{ result: CodexWorkerV2RolloutSessionResult; halt: boolean }> {
  const prepared = await deps.getPreparedFreshThreadCutover(session);
  if (!prepared) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "failed",
        reason: "verification_failed",
        detail: "awaiting-effective cutover is missing rollback provenance",
      },
      halt: true,
    };
  }

  const readiness = rolloutReadiness(session, runtime);
  if (readiness.deferReason) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "deferred",
        reason: readiness.deferReason,
        cutoverId: prepared.cutoverId,
      },
      halt: false,
    };
  }

  const effective = runtime?.effectiveMultiAgentVersion ?? null;
  if (effective === null) {
    return {
      result: {
        sessionId: session.sessionId,
        action: "awaiting_effective",
        reason: "awaiting_first_turn",
        cutoverId: prepared.cutoverId,
        effectiveVersion: null,
      },
      halt: false,
    };
  }
  if (effective !== "v2") {
    return rollbackAfterFailure(session.sessionId, prepared, "effective_version_mismatch", deps, {
      cutoverId: prepared.cutoverId,
      detail: `first retained turn reported ${effective}`,
      effectiveVersion: effective,
      requireRelaunch: runtime?.backendConnected === true,
    });
  }

  try {
    await deps.commitFreshThreadCutover(prepared, "confirmed_v2");
  } catch (error) {
    return rollbackAfterFailure(session.sessionId, prepared, "commit_failed", deps, {
      cutoverId: prepared.cutoverId,
      detail: errorMessage(error),
      effectiveVersion: effective,
      requireRelaunch: true,
    });
  }
  return {
    result: {
      sessionId: session.sessionId,
      action: "migrated",
      reason: "cutover_complete",
      cutoverId: prepared.cutoverId,
      effectiveVersion: "v2",
    },
    halt: false,
  };
}

function rolloutReadiness(
  session: CodexWorkerV2RolloutSession,
  runtime: CodexWorkerV2RuntimeSnapshot | null,
): {
  activation: "now" | "next_resume";
  deferReason?: Extract<
    CodexWorkerV2RolloutReason,
    "interrupted_turn" | "active_turn" | "paused" | "pending_permission" | "initializing" | "backend_unhealthy"
  >;
} {
  if (runtime?.interruptedDuringTurn) {
    return { activation: "now", deferReason: "interrupted_turn" };
  }
  if (runtime?.paused) {
    return { activation: "next_resume", deferReason: "paused" };
  }
  if (runtime?.pendingPermissionCount && runtime.pendingPermissionCount > 0) {
    return { activation: "now", deferReason: "pending_permission" };
  }
  if (runtime?.isGenerating || runtime?.hasActiveTurn || session.state === "running") {
    return { activation: "now", deferReason: "active_turn" };
  }
  if (
    session.state === "starting" ||
    runtime?.backendState === "initializing" ||
    runtime?.backendState === "resuming" ||
    runtime?.backendState === "recovering" ||
    runtime?.relaunchPending === true ||
    (runtime?.backendAttached && !runtime.backendConnected)
  ) {
    return { activation: "now", deferReason: "initializing" };
  }
  if (runtime?.backendState === "broken" || runtime?.backendState === "recovery_suppressed") {
    return { activation: "next_resume", deferReason: "backend_unhealthy" };
  }
  if (runtime?.backendConnected && runtime.backendState === "connected") {
    return { activation: "now" };
  }
  return { activation: "next_resume" };
}

async function verifyPreservation(
  sessionId: string,
  baseline: CodexWorkerRolloutPreservationSnapshot,
  deps: Pick<CodexWorkerV2RolloutDeps, "capturePreservationSnapshot">,
): Promise<string[]> {
  try {
    const current = await deps.capturePreservationSnapshot(sessionId);
    return compareCodexWorkerRolloutPreservation(baseline, current);
  } catch (error) {
    return [`verification_failed:${errorMessage(error)}`];
  }
}

function preservationFailureReason(differences: string[]): "preservation_mismatch" | "verification_failed" {
  return differences.some((difference) => difference.startsWith("verification_failed:"))
    ? "verification_failed"
    : "preservation_mismatch";
}

async function rollbackAfterFailure(
  sessionId: string,
  prepared: CodexWorkerPreparedV2Cutover,
  reason: Parameters<CodexWorkerV2RolloutDeps["rollbackFreshThreadCutover"]>[0]["reason"],
  deps: Pick<CodexWorkerV2RolloutDeps, "rollbackFreshThreadCutover">,
  options: {
    cutoverId: string;
    detail?: string;
    effectiveVersion?: CodexEffectiveMultiAgentVersion | null;
    preservationDifferences?: string[];
    requireRelaunch: boolean;
    deferredAfterRollback?: boolean;
  },
): Promise<{ result: CodexWorkerV2RolloutSessionResult; halt: boolean }> {
  let rollback: CodexWorkerV2RollbackResult;
  try {
    rollback = await deps.rollbackFreshThreadCutover({
      prepared,
      reason,
      targetVersion: "v1",
      requireRelaunch: options.requireRelaunch,
    });
  } catch (error) {
    rollback = { ok: false, error: errorMessage(error) };
  }

  const rollbackAwaitingFirstTurn =
    options.requireRelaunch && rollback.ok && rollback.awaitingFirstTurn === true && rollback.effectiveVersion == null;
  const rollbackVersionMismatch =
    options.requireRelaunch && rollback.ok && !rollbackAwaitingFirstTurn && rollback.effectiveVersion !== "v1";
  if (!rollback.ok || rollbackVersionMismatch) {
    return {
      result: {
        sessionId,
        action: "rollback_failed",
        reason,
        cutoverId: options.cutoverId,
        detail:
          rollback.error ??
          `V1 rollback reported effective version ${rollback.effectiveVersion === null ? "unknown" : rollback.effectiveVersion}`,
        effectiveVersion: rollback.effectiveVersion ?? options.effectiveVersion,
        preservationDifferences: options.preservationDifferences,
      },
      halt: true,
    };
  }

  if (rollbackAwaitingFirstTurn) {
    return {
      result: {
        sessionId,
        action: "awaiting_effective",
        reason: "awaiting_first_turn",
        cutoverId: options.cutoverId,
        detail: "fresh V1 rollback thread attached and is awaiting its first retained turn_context",
        effectiveVersion: null,
        preservationDifferences: options.preservationDifferences,
      },
      halt: true,
    };
  }

  if (options.deferredAfterRollback) {
    return {
      result: {
        sessionId,
        action: "deferred",
        reason: "became_active",
        cutoverId: options.cutoverId,
        detail: options.detail,
      },
      halt: false,
    };
  }

  return {
    result: {
      sessionId,
      action: "rolled_back",
      reason,
      cutoverId: options.cutoverId,
      detail: options.detail,
      effectiveVersion: rollback.effectiveVersion ?? options.effectiveVersion,
      preservationDifferences: options.preservationDifferences,
    },
    halt: true,
  };
}

function isExactPrefix(
  baseline: readonly CodexWorkerRolloutPreservedItem[],
  current: readonly CodexWorkerRolloutPreservedItem[],
): boolean {
  if (baseline.length > current.length) return false;
  return baseline.every((item, index) => samePreservedItem(item, current[index]));
}

function isOrderedSubsequence(
  baseline: readonly CodexWorkerRolloutPreservedItem[],
  current: readonly CodexWorkerRolloutPreservedItem[],
): boolean {
  let cursor = 0;
  for (const item of baseline) {
    while (cursor < current.length && !samePreservedItem(item, current[cursor])) cursor += 1;
    if (cursor >= current.length) return false;
    cursor += 1;
  }
  return true;
}

function samePreservedItem(
  left: CodexWorkerRolloutPreservedItem,
  right: CodexWorkerRolloutPreservedItem | undefined,
): boolean {
  return !!right && left.id === right.id && left.fingerprint === right.fingerprint;
}

function normalizeMaxSessions(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return DEFAULT_MAX_SESSIONS_PER_RUN;
  return Math.min(value, MAX_SESSIONS_PER_RUN);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
