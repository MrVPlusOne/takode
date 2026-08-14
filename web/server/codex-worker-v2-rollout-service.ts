import { createHash } from "node:crypto";
import { resolveCompanionCodexSessionHome } from "./codex-home.js";
import { readCodexRolloutRuntimeDiagnostics } from "./codex-rollout-runtime-diagnostics.js";
import {
  createCodexWorkerV2CutoverState,
  hashCodexWorkerPreservedItems,
  type CodexWorkerV2CutoverState,
} from "./codex-worker-v2-cutover-state.js";
import {
  CODEX_WORKER_V2_HANDOFF_DEFAULT_MAX_HISTORY_SCAN_ENTRIES,
  type CodexWorkerHandoffHistoryEntry,
} from "./codex-worker-v2-handoff.js";
import {
  isOrdinaryCodexWorker,
  runCodexWorkerV2Rollout,
  type CodexWorkerPreparedV2Cutover,
  type CodexWorkerRolloutPreservationSnapshot,
  type CodexWorkerV2RolloutResult,
  type CodexWorkerV2RolloutSession,
} from "./codex-worker-v2-rollout.js";
import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import {
  beginCodexWorkerV2DeliveryFreeze,
  registerCodexWorkerV2RolloutHooks,
  releaseCodexWorkerV2DeliveryFreeze,
} from "./codex-worker-v2-rollout-hooks.js";

const ROLLOUT_RETRY_MS = 5_000;
const SESSION_META_WAIT_MS = 30_000;
const SESSION_META_POLL_MS = 100;
const MAX_SESSIONS_PER_RUN = 100;

type RolloutLog = (message: string, data?: Record<string, unknown>) => void;

type PreparedOpaque = {
  previousCliSessionId?: string;
};

export interface CodexWorkerV2RolloutServiceOptions {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  getSessionName?: (sessionId: string) => string | undefined;
  log?: RolloutLog;
  retryMs?: number;
}

export class CodexWorkerV2RolloutService {
  private readonly launcher: CliLauncher;
  private readonly wsBridge: WsBridge;
  private readonly getSessionName: (sessionId: string) => string | undefined;
  private readonly log: RolloutLog;
  private readonly retryMs: number;
  private runChain: Promise<CodexWorkerV2RolloutResult | null> = Promise.resolve(null);
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSummaryFingerprint = "";
  private lastHaltedResult: CodexWorkerV2RolloutResult | null = null;
  private runtimeHalted = false;
  private shuttingDown = false;
  private destroyed = false;
  private destroyPromise: Promise<void> | null = null;
  private readonly unregisterHooks: () => void;

  constructor(options: CodexWorkerV2RolloutServiceOptions) {
    this.launcher = options.launcher;
    this.wsBridge = options.wsBridge;
    this.getSessionName = options.getSessionName ?? (() => undefined);
    this.log = options.log ?? (() => {});
    this.retryMs = options.retryMs ?? ROLLOUT_RETRY_MS;
    this.unregisterHooks = registerCodexWorkerV2RolloutHooks({
      beforeSessionMetaDispatch: (sessionId, cliSessionId) => this.beforeSessionMetaDispatch(sessionId, cliSessionId),
      onActivity: (sessionId, reason) => this.onSessionActivity(sessionId, reason),
    });
  }

  schedule(reason: string): Promise<CodexWorkerV2RolloutResult | null> {
    if (this.shuttingDown || this.destroyed || (this.runtimeHalted && !this.lastHaltedResult)) {
      return Promise.resolve(this.lastHaltedResult);
    }
    this.runChain = this.runChain
      .catch(() => null)
      .then(() => this.run(reason))
      .catch((error) => {
        this.runtimeHalted = true;
        this.log("Codex worker V2 rollout failed closed", {
          reason,
          error: errorMessage(error),
        });
        return null;
      });
    return this.runChain;
  }

  private beforeSessionMetaDispatch(sessionId: string, cliSessionId: string): boolean | Promise<boolean> {
    const info = this.launcher.getSession(sessionId);
    const cutover = info?.codexWorkerV2Cutover;
    if (!info || !cutover) return true;
    if (this.destroyed) return false;
    return this.beforeCutoverSessionMetaDispatch(info, cutover, cliSessionId);
  }

  private async beforeCutoverSessionMetaDispatch(
    info: NonNullable<ReturnType<CliLauncher["getSession"]>>,
    cutover: CodexWorkerV2CutoverState,
    cliSessionId: string,
  ): Promise<boolean> {
    const sessionId = info.sessionId;
    const isOriginalThread =
      (cutover.originalCliSessionId !== null && cliSessionId === cutover.originalCliSessionId) ||
      (cutover.status === "rolling_back" && cutover.originalCliSessionId === null);
    if (isOriginalThread) {
      if (cutover.status === "prepared" || cutover.status === "staged") {
        this.launcher.updateSessionLaunchConfig(sessionId, {
          cliSessionId,
          codexMultiAgentVersion: cutover.originalSelectedVersion ?? undefined,
          codexWorkerV2Cutover: undefined,
        });
        releaseCodexWorkerV2DeliveryFreeze(sessionId, cutover.cutoverId);
        void this.schedule(`original_session_meta:${sessionId}`);
        return true;
      }
      if (cutover.status === "rolling_back" || cutover.status === "rollback_failed") {
        return this.verifyRollbackSessionMeta(info, cutover, cliSessionId);
      }
      if (cutover.status === "rolled_back") return true;
      return false;
    }

    if (cutover.status === "awaiting_rollback_effective") {
      return cutover.rollbackCliSessionId === cliSessionId;
    }
    if (cutover.status === "rolling_back" || cutover.status === "rollback_failed" || cutover.status === "rolled_back") {
      return false;
    }
    if (cutover.status === "awaiting_effective" && cutover.replacementCliSessionId === cliSessionId) return true;

    const current = await this.capturePreservationSnapshot(sessionId);
    const preservationDifferences = compareDurablePreservation(cutover, current);
    if (preservationDifferences.length > 0) {
      const failed = {
        ...cutover,
        replacementCliSessionId: cliSessionId,
        sessionMetaObservedAt: Date.now(),
        updatedAt: Date.now(),
        oneShotExtraInstructions: undefined,
        lastFailure: {
          reason: "preservation_mismatch",
          detail: preservationDifferences.join(", "),
          observedAt: Date.now(),
        },
      } satisfies CodexWorkerV2CutoverState;
      this.launcher.updateSessionLaunchConfig(sessionId, {
        codexWorkerV2Cutover: failed,
      });
      if (cutover.status === "prepared" || cutover.status === "staged") {
        await this.rollbackFreshThreadCutover({
          prepared: preparedFromCutover(sessionId, failed),
          reason: "preservation_mismatch",
          targetVersion: "v1",
          requireRelaunch: true,
        });
      }
      return false;
    }

    const verifiedAt = Date.now();
    this.launcher.updateSessionLaunchConfig(sessionId, {
      codexWorkerV2Cutover: {
        ...cutover,
        status: "awaiting_effective",
        replacementCliSessionId: cliSessionId,
        sessionMetaObservedAt: verifiedAt,
        preservationVerifiedAt: verifiedAt,
        updatedAt: verifiedAt,
        oneShotExtraInstructions: undefined,
      },
    });
    releaseCodexWorkerV2DeliveryFreeze(sessionId, cutover.cutoverId);
    void this.schedule(`session_meta:${sessionId}`);
    return true;
  }

  private async verifyRollbackSessionMeta(
    info: NonNullable<ReturnType<CliLauncher["getSession"]>>,
    cutover: CodexWorkerV2CutoverState,
    cliSessionId: string,
  ): Promise<boolean> {
    const diagnostics = await readSessionDiagnostics(info, cliSessionId);
    const current = this.launcher.getSession(info.sessionId)?.codexWorkerV2Cutover;
    if (!current || current.cutoverId !== cutover.cutoverId) return false;
    const observedAt = Date.now();
    if (diagnostics.codexEffectiveMultiAgentVersion === "v1") {
      this.launcher.updateSessionLaunchConfig(info.sessionId, {
        codexMultiAgentVersion: "v1",
        cliSessionId,
        codexWorkerV2Cutover: {
          ...current,
          status: "rolled_back",
          rollbackCliSessionId: cliSessionId,
          rollbackSessionMetaObservedAt: observedAt,
          effectiveVersion: "v1",
          updatedAt: observedAt,
          oneShotExtraInstructions: undefined,
        },
      });
      releaseCodexWorkerV2DeliveryFreeze(info.sessionId, current.cutoverId);
      return true;
    }
    if (diagnostics.codexEffectiveMultiAgentVersion === null && current.originalCliSessionId === null) {
      this.launcher.updateSessionLaunchConfig(info.sessionId, {
        codexMultiAgentVersion: "v1",
        cliSessionId,
        codexWorkerV2Cutover: {
          ...current,
          status: "awaiting_rollback_effective",
          rollbackCliSessionId: cliSessionId,
          rollbackSessionMetaObservedAt: observedAt,
          effectiveVersion: null,
          updatedAt: observedAt,
          oneShotExtraInstructions: undefined,
        },
      });
      releaseCodexWorkerV2DeliveryFreeze(info.sessionId, current.cutoverId);
      void this.schedule(`rollback_session_meta:${info.sessionId}`);
      return true;
    }
    const detail = `attached rollback thread reported ${diagnostics.codexEffectiveMultiAgentVersion ?? "unknown"}`;
    this.markRollbackFailed(info.sessionId, current, current.lastFailure?.reason ?? "verification_failed", detail);
    return false;
  }

  onTurnCompleted(sessionId: string): void {
    const info = this.launcher.getSession(sessionId);
    if (!info || info.backendType !== "codex" || info.archived) return;
    void this.schedule(`turn_completed:${sessionId}`);
  }

  private onSessionActivity(sessionId: string, reason: string): void {
    const info = this.launcher.getSession(sessionId);
    if (!info || !isOrdinaryCodexWorker(info) || info.codexMultiAgentVersion === "v1") return;
    void this.schedule(`activity:${reason}:${sessionId}`);
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.shuttingDown = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.destroyPromise = this.runChain
      .catch(() => null)
      .then(() => {
        this.destroyed = true;
        this.unregisterHooks();
        for (const info of this.launcher.listSessions()) {
          if (info.codexWorkerV2Cutover) {
            releaseCodexWorkerV2DeliveryFreeze(info.sessionId, info.codexWorkerV2Cutover.cutoverId);
          }
        }
      });
    return this.destroyPromise;
  }

  private async run(reason: string): Promise<CodexWorkerV2RolloutResult> {
    const awaitingRollback = this.launcher
      .listSessions()
      .find(
        (info) => isOrdinaryCodexWorker(info) && info.codexWorkerV2Cutover?.status === "awaiting_rollback_effective",
      );
    if (awaitingRollback) await this.reconcileAwaitingRollbackEffective(awaitingRollback);

    const durableBlocker = this.launcher
      .listSessions()
      .find(
        (info) =>
          isOrdinaryCodexWorker(info) &&
          (info.codexWorkerV2Cutover?.status === "awaiting_rollback_effective" ||
            info.codexWorkerV2Cutover?.status === "rolled_back" ||
            info.codexWorkerV2Cutover?.status === "rollback_failed"),
      );
    if (this.runtimeHalted && !durableBlocker && this.lastHaltedResult) return this.lastHaltedResult;
    const result = durableBlocker
      ? blockedRolloutResult(durableBlocker, this.listSessions())
      : await runCodexWorkerV2Rollout(this.buildControllerDeps(), {
          maxSessions: MAX_SESSIONS_PER_RUN,
        });
    for (const entry of result.results) {
      if (entry.reason !== "effective_v2") continue;
      const info = this.launcher.getSession(entry.sessionId);
      if (info && info.codexMultiAgentVersion === undefined) {
        this.launcher.updateSessionLaunchConfig(entry.sessionId, {
          codexMultiAgentVersion: "v2",
        });
      }
    }
    const summary = summarizeRollout(result);
    const summaryFingerprint = JSON.stringify(summary);
    if (reason !== "retry" || summaryFingerprint !== this.lastSummaryFingerprint) {
      this.log("Codex worker V2 rollout reconciliation", {
        reason,
        ...summary,
      });
    }
    this.lastSummaryFingerprint = summaryFingerprint;
    if (result.halted) {
      this.runtimeHalted = true;
      this.lastHaltedResult = result;
    }
    if (!result.halted && result.results.some((entry) => entry.reason === "batch_limit")) {
      this.scheduleRetry();
    }
    return result;
  }

  private async reconcileAwaitingRollbackEffective(
    info: NonNullable<ReturnType<CliLauncher["getSession"]>>,
  ): Promise<void> {
    const cutover = info.codexWorkerV2Cutover;
    if (!cutover || cutover.status !== "awaiting_rollback_effective") return;
    const diagnostics = await readSessionDiagnostics(info, cutover.rollbackCliSessionId ?? info.cliSessionId ?? "");
    const current = this.launcher.getSession(info.sessionId)?.codexWorkerV2Cutover;
    if (!current || current.cutoverId !== cutover.cutoverId || current.status !== "awaiting_rollback_effective") return;
    const observedVersion = diagnostics.codexEffectiveMultiAgentVersion;
    if (observedVersion === null) return;
    if (observedVersion !== "v1") {
      this.markRollbackFailed(
        info.sessionId,
        current,
        current.lastFailure?.reason ?? "effective_version_mismatch",
        `first retained V1 rollback turn reported ${observedVersion}`,
      );
      return;
    }
    this.launcher.updateSessionLaunchConfig(info.sessionId, {
      codexMultiAgentVersion: "v1",
      cliSessionId: current.rollbackCliSessionId ?? info.cliSessionId,
      codexWorkerV2Cutover: {
        ...current,
        status: "rolled_back",
        effectiveVersion: "v1",
        updatedAt: Date.now(),
      },
    });
  }

  private scheduleRetry(): void {
    if (this.shuttingDown || this.destroyed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.schedule("retry");
    }, this.retryMs);
    this.retryTimer.unref?.();
  }

  private buildControllerDeps(): Parameters<typeof runCodexWorkerV2Rollout>[0] {
    return {
      listSessions: () => this.listSessions(),
      getRuntimeSnapshot: (sessionId) => this.getRuntimeSnapshot(sessionId),
      getHandoffInput: (session) => this.getHandoffInput(session.sessionId),
      capturePreservationSnapshot: (sessionId) => this.capturePreservationSnapshot(sessionId),
      freezeModelBoundDelivery: (sessionId, cutoverId) =>
        beginCodexWorkerV2DeliveryFreeze(sessionId, cutoverId, this.wsBridge.getSession(sessionId)),
      releaseModelBoundDelivery: (sessionId, cutoverId) => releaseCodexWorkerV2DeliveryFreeze(sessionId, cutoverId),
      prepareFreshThreadCutover: (args) => this.prepareFreshThreadCutover(args),
      stageFreshThreadCutover: (prepared) => this.stageFreshThreadCutover(prepared),
      getPreparedFreshThreadCutover: (session) => this.getPreparedFreshThreadCutover(session.sessionId),
      relaunchFreshThread: (prepared) => this.relaunchFreshThread(prepared),
      waitForEffectiveVersion: (args) => this.waitForEffectiveVersion(args.prepared),
      commitFreshThreadCutover: (prepared, verification) => this.commitFreshThreadCutover(prepared, verification),
      rollbackFreshThreadCutover: (args) => this.rollbackFreshThreadCutover(args),
    };
  }

  private listSessions(): CodexWorkerV2RolloutSession[] {
    return this.launcher.listSessions().map((info) => ({
      sessionId: info.sessionId,
      sessionNum: info.sessionNum,
      name: this.getSessionName(info.sessionId) ?? info.name,
      state: info.state,
      backendType: info.backendType,
      archived: info.archived,
      isOrchestrator: info.isOrchestrator,
      reviewerOf: info.reviewerOf,
      hidden: info.hidden,
      publicSessionNumber: info.publicSessionNumber,
      herdedBy: info.herdedBy,
      selectedMultiAgentVersion: info.codexMultiAgentVersion,
      workerV2CutoverState: activeCutoverStatus(info.codexWorkerV2Cutover),
    }));
  }

  private async getRuntimeSnapshot(sessionId: string) {
    const info = this.launcher.getSession(sessionId);
    const session = this.wsBridge.getSession(sessionId);
    if (!info || !session) return null;
    const diagnostics = await readSessionDiagnostics(info);
    return {
      backendState: session.state.backend_state ?? null,
      backendAttached: this.wsBridge.isBackendAttached(sessionId),
      backendConnected: this.wsBridge.isBackendConnected(sessionId),
      isGenerating: session.isGenerating,
      hasActiveTurn: !!session.codexAdapter?.getCurrentTurnId?.(),
      interruptedDuringTurn: session.interruptedDuringTurn,
      relaunchPending: session.relaunchPending,
      pendingPermissionCount: session.pendingPermissions.size,
      paused: this.wsBridge.isSessionPaused(sessionId),
      effectiveMultiAgentVersion: diagnostics.codexEffectiveMultiAgentVersion,
    };
  }

  private getHandoffInput(sessionId: string) {
    const info = this.requireLauncherSession(sessionId);
    const session = this.requireBridgeSession(sessionId);
    return {
      claimedQuest: session.state.claimedQuestId
        ? {
            id: session.state.claimedQuestId,
            title: session.state.claimedQuestTitle ?? null,
            status: session.state.claimedQuestStatus ?? null,
            phase: activeQuestPhase(session, session.state.claimedQuestId),
          }
        : null,
      worktree: {
        cwd: info.cwd,
        repoRoot: info.repoRoot ?? session.state.repo_root ?? null,
        branch: info.branch ?? session.state.git_branch ?? null,
        actualBranch: info.actualBranch ?? null,
        diffBaseBranch: session.state.diff_base_branch ?? null,
      },
      pendingInputCount: session.pendingCodexInputs.length,
      pendingTurnCount: session.pendingCodexTurns.length,
      messageHistory: buildHandoffHistory(
        session.messageHistory.slice(-CODEX_WORKER_V2_HANDOFF_DEFAULT_MAX_HISTORY_SCAN_ENTRIES),
      ),
    };
  }

  private async capturePreservationSnapshot(sessionId: string): Promise<CodexWorkerRolloutPreservationSnapshot> {
    const info = this.requireLauncherSession(sessionId);
    const session = this.requireBridgeSession(sessionId);
    const history = await fingerprintItems(session.messageHistory, historyItemId);
    const pendingInputs = await fingerprintItems(session.pendingCodexInputs, pendingInputId);
    const pendingTurns = await fingerprintItems(session.pendingCodexTurns, pendingTurnId);
    return {
      history,
      pendingInputs,
      pendingTurns,
      launchConfigFingerprint: fingerprint({
        model: info.model,
        permissionMode: info.permissionMode,
        askPermission: info.askPermission,
        uiMode: info.uiMode,
        codexInternetAccess: info.codexInternetAccess,
        codexSandbox: info.codexSandbox,
        codexReasoningEffort: info.codexReasoningEffort,
        codexServiceTier: info.codexServiceTier,
        codexMaxContextLength: info.codexMaxContextLength,
        codexLeaderCompactionMode: info.codexLeaderCompactionMode,
        cwd: info.cwd,
        envSlug: info.envSlug,
      }),
      questFingerprint: fingerprint({
        claimedQuestId: session.state.claimedQuestId,
        claimedQuestTitle: session.state.claimedQuestTitle,
        claimedQuestStatus: session.state.claimedQuestStatus,
        claimedQuestLeaderSessionId: session.state.claimedQuestLeaderSessionId,
      }),
      worktreeFingerprint: fingerprint({
        isWorktree: info.isWorktree,
        repoRoot: info.repoRoot,
        branch: info.branch,
        actualBranch: info.actualBranch,
        worktreePortTarget: info.worktreePortTarget,
        cwd: info.cwd,
        diffBaseBranch: session.state.diff_base_branch,
      }),
      recoveryFingerprint: fingerprint({
        recoveryDeliveryTransfers: session.recoveryDeliveryTransfers,
        pendingCodexRollback: session.pendingCodexRollback,
        pendingCodexRollbackError: session.pendingCodexRollbackError,
        pendingMessages: session.pendingMessages,
        queuedTurnStarts: session.queuedTurnStarts,
        queuedTurnReasons: session.queuedTurnReasons,
        queuedTurnUserMessageIds: session.queuedTurnUserMessageIds,
        queuedTurnInterruptSources: session.queuedTurnInterruptSources,
        queuedTurnActiveRoutes: session.queuedTurnActiveRoutes,
        codexFreshTurnRequiredUntilTurnId: session.codexFreshTurnRequiredUntilTurnId,
        codexPendingDeliveryProofSignals: session.codexPendingDeliveryProofSignals,
        consecutiveAdapterFailures: session.consecutiveAdapterFailures,
        lastAdapterFailureAt: session.lastAdapterFailureAt,
        provisionalStuckRecovery: session.provisionalStuckRecovery,
        pause: session.state.pause,
        codexResultErrorAutoPause: session.state.codex_result_error_auto_pause,
        backendReconnect: session.state.backend_reconnect,
        codexProviderRetry: session.state.codex_provider_retry,
      }),
      sessionIdentityFingerprint: fingerprint({
        launcherSessionId: info.sessionId,
        sessionNum: info.sessionNum,
        herdedBy: info.herdedBy,
        treeGroupId: info.treeGroupId,
        memorySessionSpaceSlug: info.memorySessionSpaceSlug,
        stateSessionId: session.state.session_id,
        stateTreeGroupId: session.state.treeGroupId,
        stateMemorySessionSpaceSlug: session.state.memorySessionSpaceSlug,
        activeBoardRow: session.state.claimedQuestId
          ? (session.board?.get?.(session.state.claimedQuestId) ?? null)
          : null,
      }),
    };
  }

  private prepareFreshThreadCutover(
    args: Parameters<Parameters<typeof runCodexWorkerV2Rollout>[0]["prepareFreshThreadCutover"]>[0],
  ): CodexWorkerPreparedV2Cutover {
    const info = this.requireLauncherSession(args.session.sessionId);
    const session = this.requireBridgeSession(args.session.sessionId);
    if (!isOrdinaryCodexWorker(info)) {
      throw new Error("worker role changed before fresh-thread preparation");
    }
    if (info.codexMultiAgentVersion === "v1") {
      throw new Error("worker selected explicit V1 before fresh-thread preparation");
    }
    if (
      session.isGenerating ||
      session.interruptedDuringTurn ||
      session.pendingPermissions.size > 0 ||
      session.codexAdapter?.getCurrentTurnId?.()
    ) {
      throw new Error("worker became active before fresh-thread preparation");
    }
    const previousCliSessionId = info.cliSessionId;
    const cutover = createCodexWorkerV2CutoverState({
      activation: args.activation,
      originalCliSessionId: previousCliSessionId,
      requestedAt: Date.now(),
      handoff: args.handoff,
      originalSelectedVersion: info.codexMultiAgentVersion,
      preservation: args.preservationBaseline,
    });
    this.launcher.updateSessionLaunchConfig(info.sessionId, {
      cliSessionId: undefined,
      resumeRetried: false,
      codexMultiAgentVersion: "v2",
      codexWorkerV2Cutover: cutover,
    });
    return {
      sessionId: info.sessionId,
      cutoverId: args.cutoverId,
      activation: args.activation,
      opaque: { previousCliSessionId } satisfies PreparedOpaque,
    };
  }

  private stageFreshThreadCutover(prepared: CodexWorkerPreparedV2Cutover): void {
    const info = this.requireMatchingCutover(prepared);
    this.launcher.updateSessionLaunchConfig(info.sessionId, {
      codexWorkerV2Cutover: {
        ...info.codexWorkerV2Cutover!,
        status: "staged",
        updatedAt: Date.now(),
      },
    });
  }

  private getPreparedFreshThreadCutover(sessionId: string): CodexWorkerPreparedV2Cutover | null {
    const info = this.launcher.getSession(sessionId);
    const cutover = info?.codexWorkerV2Cutover;
    if (!info || !cutover || cutover.status !== "awaiting_effective") return null;
    return {
      sessionId,
      cutoverId: cutover.cutoverId,
      activation: cutover.activation,
      opaque: {
        previousCliSessionId: cutover.originalCliSessionId ?? undefined,
      } satisfies PreparedOpaque,
    };
  }

  private async relaunchFreshThread(prepared: CodexWorkerPreparedV2Cutover) {
    const info = this.requireMatchingCutover(prepared);
    this.launcher.updateSessionLaunchConfig(info.sessionId, {
      codexWorkerV2Cutover: {
        ...info.codexWorkerV2Cutover!,
        status: "activating",
        updatedAt: Date.now(),
      },
    });
    return this.launcher.relaunch(info.sessionId);
  }

  private async waitForEffectiveVersion(prepared: CodexWorkerPreparedV2Cutover) {
    const deadline = Date.now() + SESSION_META_WAIT_MS;
    while (Date.now() < deadline) {
      if (this.shuttingDown || this.destroyed) {
        return {
          version: null,
          detail: "server shutdown left the durable cutover pending for restart recovery",
          aborted: true,
        };
      }
      const info = this.launcher.getSession(prepared.sessionId);
      const cutover = info?.codexWorkerV2Cutover;
      if (!info || !cutover || cutover.cutoverId !== prepared.cutoverId) {
        throw new Error("fresh Codex cutover lost durable session_meta provenance");
      }
      if (cutover.lastFailure?.reason === "preservation_mismatch") {
        throw new Error(cutover.lastFailure.detail ?? "fresh Codex cutover failed preservation verification");
      }
      if (
        cutover.status === "awaiting_effective" &&
        cutover.preservationVerifiedAt &&
        cutover.replacementCliSessionId &&
        info.cliSessionId === cutover.replacementCliSessionId
      ) {
        const diagnostics = await readSessionDiagnostics(info);
        return {
          version: diagnostics.codexEffectiveMultiAgentVersion,
          detail: diagnostics.codexEffectiveMultiAgentVersionReported
            ? undefined
            : diagnostics.codexMultiAgentRuntimeDiagnostics.status,
        };
      }
      if (
        cutover.status === "rolling_back" ||
        cutover.status === "rolled_back" ||
        cutover.status === "rollback_failed"
      ) {
        throw new Error(cutover.lastFailure?.detail ?? `fresh Codex cutover entered ${cutover.status}`);
      }
      await delay(SESSION_META_POLL_MS);
    }
    throw new Error("fresh Codex thread did not pass the session_meta preservation barrier before timeout");
  }

  private commitFreshThreadCutover(
    prepared: CodexWorkerPreparedV2Cutover,
    verification: "confirmed_v2" | "awaiting_first_turn",
  ): void {
    const info = this.requireMatchingCutover(prepared);
    if (verification === "confirmed_v2") {
      this.launcher.updateSessionLaunchConfig(info.sessionId, {
        codexWorkerV2Cutover: undefined,
      });
      return;
    }
    const current = info.codexWorkerV2Cutover!;
    this.launcher.updateSessionLaunchConfig(info.sessionId, {
      codexWorkerV2Cutover: {
        ...current,
        status: "awaiting_effective",
        updatedAt: Date.now(),
        replacementCliSessionId: info.cliSessionId ?? null,
        sessionMetaObservedAt: current.sessionMetaObservedAt ?? Date.now(),
        effectiveVersion: null,
        oneShotExtraInstructions: undefined,
      },
    });
  }

  private async rollbackFreshThreadCutover(
    args: Parameters<Parameters<typeof runCodexWorkerV2Rollout>[0]["rollbackFreshThreadCutover"]>[0],
  ) {
    const info = this.requireMatchingCutover(args.prepared);
    const current = info.codexWorkerV2Cutover!;
    const previousCliSessionId =
      preparedOpaque(args.prepared).previousCliSessionId ?? current.originalCliSessionId ?? undefined;
    const frozen = beginCodexWorkerV2DeliveryFreeze(
      info.sessionId,
      current.cutoverId,
      this.wsBridge.getSession(info.sessionId),
    );
    if (!frozen) {
      const detail = "worker became active before V1 rollback could freeze model-bound delivery";
      this.markRollbackFailed(info.sessionId, current, args.reason, detail);
      return { ok: false, error: detail };
    }

    if (!args.requireRelaunch && args.reason === "became_active") {
      this.launcher.updateSessionLaunchConfig(info.sessionId, {
        codexMultiAgentVersion: current.originalSelectedVersion ?? undefined,
        cliSessionId: previousCliSessionId,
        resumeRetried: false,
        codexWorkerV2Cutover: undefined,
      });
      releaseCodexWorkerV2DeliveryFreeze(info.sessionId, current.cutoverId);
      return { ok: true, effectiveVersion: "v1" as const };
    }

    const rollbackRequestedAt = Date.now();
    this.launcher.updateSessionLaunchConfig(info.sessionId, {
      codexMultiAgentVersion: "v1",
      cliSessionId: previousCliSessionId,
      resumeRetried: false,
      codexWorkerV2Cutover: {
        ...current,
        status: args.requireRelaunch ? "rolling_back" : "rolled_back",
        updatedAt: rollbackRequestedAt,
        oneShotExtraInstructions: undefined,
        effectiveVersion: args.requireRelaunch ? null : "v1",
        lastFailure: current.lastFailure ?? {
          reason: args.reason,
          observedAt: rollbackRequestedAt,
        },
      },
    });
    if (!args.requireRelaunch) {
      releaseCodexWorkerV2DeliveryFreeze(info.sessionId, current.cutoverId);
      return { ok: true, effectiveVersion: "v1" as const };
    }

    const relaunch = await this.launcher.relaunch(info.sessionId);
    if (!relaunch.ok) {
      const failed = this.requireLauncherSession(info.sessionId).codexWorkerV2Cutover ?? current;
      const detail = relaunch.error ?? "V1 rollback relaunch failed";
      this.markRollbackFailed(info.sessionId, failed, args.reason, detail);
      return { ok: false, error: detail };
    }
    return this.waitForRollbackProof(info.sessionId, current.cutoverId, args.reason);
  }

  private async waitForRollbackProof(sessionId: string, cutoverId: string, reason: string) {
    const deadline = Date.now() + SESSION_META_WAIT_MS;
    while (Date.now() < deadline) {
      const current = this.launcher.getSession(sessionId)?.codexWorkerV2Cutover;
      if (!current || current.cutoverId !== cutoverId) {
        return {
          ok: false,
          error: "V1 rollback lost durable session_meta provenance",
        };
      }
      if (current.status === "rolled_back" && current.effectiveVersion === "v1") {
        return { ok: true, effectiveVersion: "v1" as const };
      }
      if (current.status === "awaiting_rollback_effective" && current.rollbackSessionMetaObservedAt) {
        return { ok: true, effectiveVersion: null, awaitingFirstTurn: true };
      }
      if (current.status === "rollback_failed") {
        return {
          ok: false,
          effectiveVersion: current.effectiveVersion ?? null,
          error: current.lastFailure?.detail,
        };
      }
      if (this.destroyed) {
        const detail = "V1 rollback proof interrupted by server shutdown";
        this.markRollbackFailed(sessionId, current, reason, detail);
        return { ok: false, error: detail };
      }
      await delay(SESSION_META_POLL_MS);
    }
    const current = this.launcher.getSession(sessionId)?.codexWorkerV2Cutover;
    const detail = "V1 rollback adapter did not report matching session_meta before timeout";
    if (current?.cutoverId === cutoverId) this.markRollbackFailed(sessionId, current, reason, detail);
    return { ok: false, error: detail };
  }

  private markRollbackFailed(
    sessionId: string,
    cutover: CodexWorkerV2CutoverState,
    reason: string,
    detail: string,
  ): void {
    this.launcher.updateSessionLaunchConfig(sessionId, {
      codexMultiAgentVersion: "v1",
      codexWorkerV2Cutover: {
        ...cutover,
        status: "rollback_failed",
        updatedAt: Date.now(),
        oneShotExtraInstructions: undefined,
        lastFailure: { reason, detail, observedAt: Date.now() },
      },
    });
  }

  private requireMatchingCutover(prepared: CodexWorkerPreparedV2Cutover) {
    const info = this.requireLauncherSession(prepared.sessionId);
    if (info.codexWorkerV2Cutover?.cutoverId !== prepared.cutoverId) {
      throw new Error(`Codex worker cutover ${prepared.cutoverId} is no longer current`);
    }
    return info;
  }

  private requireLauncherSession(sessionId: string) {
    const info = this.launcher.getSession(sessionId);
    if (!info) throw new Error(`Launcher session ${sessionId} not found`);
    return info;
  }

  private requireBridgeSession(sessionId: string) {
    const session = this.wsBridge.getSession(sessionId);
    if (!session) throw new Error(`Bridge session ${sessionId} not found`);
    return session;
  }
}

function activeCutoverStatus(
  cutover: CodexWorkerV2CutoverState | undefined,
): CodexWorkerV2RolloutSession["workerV2CutoverState"] {
  return cutover?.status ?? null;
}

function preparedFromCutover(sessionId: string, cutover: CodexWorkerV2CutoverState): CodexWorkerPreparedV2Cutover {
  return {
    sessionId,
    cutoverId: cutover.cutoverId,
    activation: cutover.activation,
    opaque: {
      previousCliSessionId: cutover.originalCliSessionId ?? undefined,
    } satisfies PreparedOpaque,
  };
}

function compareDurablePreservation(
  cutover: CodexWorkerV2CutoverState,
  current: CodexWorkerRolloutPreservationSnapshot,
): string[] {
  const differences: string[] = [];
  const preservation = cutover.preservation;
  if (
    current.history.length < preservation.historyCount ||
    hashCodexWorkerPreservedItems(current.history.slice(0, preservation.historyCount)) !==
      preservation.historyPrefixFingerprint
  ) {
    differences.push("history_changed_or_removed");
  }
  if (!isPreservedSubsequence(preservation.pendingInputs, current.pendingInputs)) {
    differences.push("pending_inputs_changed_or_removed");
  }
  if (!isPreservedSubsequence(preservation.pendingTurns, current.pendingTurns)) {
    differences.push("pending_turns_changed_or_removed");
  }
  if (preservation.launchConfigFingerprint !== current.launchConfigFingerprint)
    differences.push("launch_config_changed");
  if (preservation.questFingerprint !== current.questFingerprint) differences.push("quest_identity_changed");
  if (preservation.worktreeFingerprint !== current.worktreeFingerprint) differences.push("worktree_identity_changed");
  if (preservation.recoveryFingerprint !== current.recoveryFingerprint) differences.push("recovery_state_changed");
  if (preservation.sessionIdentityFingerprint !== current.sessionIdentityFingerprint)
    differences.push("session_identity_changed");
  return differences;
}

function isPreservedSubsequence(
  baseline: readonly { id: string; fingerprint: string }[],
  current: readonly { id: string; fingerprint: string }[],
): boolean {
  let cursor = 0;
  for (const expected of baseline) {
    while (
      cursor < current.length &&
      (current[cursor]?.id !== expected.id || current[cursor]?.fingerprint !== expected.fingerprint)
    ) {
      cursor += 1;
    }
    if (cursor >= current.length) return false;
    cursor += 1;
  }
  return true;
}

function blockedRolloutResult(
  blocker: NonNullable<ReturnType<CliLauncher["getSession"]>>,
  sessions: CodexWorkerV2RolloutSession[],
): CodexWorkerV2RolloutResult {
  const eligibleSessions = sessions.filter(isOrdinaryCodexWorker).length;
  const status = blocker.codexWorkerV2Cutover?.status;
  const failed = status === "rollback_failed";
  const awaiting = status === "awaiting_rollback_effective";
  return {
    results: [
      {
        sessionId: blocker.sessionId,
        action: awaiting ? "awaiting_effective" : failed ? "rollback_failed" : "rolled_back",
        reason: awaiting ? "awaiting_first_turn" : "rollout_halted",
        detail: awaiting
          ? "Fresh V1 rollback thread is attached and awaiting its first retained turn_context."
          : (blocker.codexWorkerV2Cutover?.lastFailure?.detail ??
            "A prior worker cutover rolled back; explicit operator review is required before rollout can continue."),
        effectiveVersion: blocker.codexWorkerV2Cutover?.effectiveVersion ?? null,
      },
    ],
    eligibleSessions,
    processedEligibleSessions: 0,
    remainingEligibleSessions: eligibleSessions,
    halted: true,
  };
}

function preparedOpaque(prepared: CodexWorkerPreparedV2Cutover): PreparedOpaque {
  return (prepared.opaque ?? {}) as PreparedOpaque;
}

async function readSessionDiagnostics(
  info: NonNullable<ReturnType<CliLauncher["getSession"]>>,
  cliSessionId = info.cliSessionId ?? "",
) {
  const home = resolveCompanionCodexSessionHome(info.sessionId, info.codexHome);
  return readCodexRolloutRuntimeDiagnostics(home, cliSessionId);
}

async function fingerprintItems<T>(
  items: readonly T[],
  idForItem: (item: T, index: number) => string,
): Promise<Array<{ id: string; fingerprint: string }>> {
  const result: Array<{ id: string; fingerprint: string }> = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    result.push({ id: idForItem(item, index), fingerprint: fingerprint(item) });
    if (index > 0 && index % 250 === 0) await delay(0);
  }
  return result;
}

function historyItemId(item: any, index: number): string {
  return String(item?.id ?? item?.message?.id ?? item?.uuid ?? `${item?.type ?? "message"}:${index}`);
}

function pendingInputId(item: any, index: number): string {
  return String(item?.id ?? item?.userMessageId ?? `pending-input:${index}`);
}

function pendingTurnId(item: any, index: number): string {
  return String(item?.turnId ?? item?.userMessageId ?? `pending-turn:${index}`);
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value) ?? String(value);
  return createHash("sha256").update(serialized).digest("hex");
}

function buildHandoffHistory(messages: readonly any[]): CodexWorkerHandoffHistoryEntry[] {
  const history: CodexWorkerHandoffHistoryEntry[] = [];
  for (const message of messages) {
    if (message?.type === "user_message" || message?.type === "leader_user_message") {
      history.push({
        type: message.type,
        id: message.id,
        content: message.content,
        agentSource: message.agentSource,
      });
    } else if (message?.type === "assistant") {
      history.push({
        type: "assistant",
        id: message.message?.id,
        message: {
          role: message.message?.role,
          content: message.message?.content,
        },
      });
    }
  }
  return history;
}

function activeQuestPhase(session: any, questId: string): string | null {
  const row = session.board?.get?.(questId);
  return typeof row?.activePhaseId === "string"
    ? row.activePhaseId
    : typeof row?.status === "string"
      ? row.status
      : null;
}

function summarizeRollout(result: CodexWorkerV2RolloutResult): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const entry of result.results) counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  return {
    eligibleSessions: result.eligibleSessions,
    processedEligibleSessions: result.processedEligibleSessions,
    remainingEligibleSessions: result.remainingEligibleSessions,
    halted: result.halted,
    counts,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
