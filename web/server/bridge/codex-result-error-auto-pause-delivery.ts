import {
  buildCodexAutoPauseDiagnostic,
  getCodexAutoPauseRecoveryProgress,
  getActiveCodexResultErrorAutoPause,
  isAutomaticCodexAutoPauseInput,
  materializeCodexAutoPausedInputsForDrain,
  noteCodexAutoPauseRecoverySuccess,
  noteCodexResultForAutoPause,
  queueCodexAutoPausedInput,
  sweepCodexAutoPausedQueuedBacklog,
} from "../codex-result-error-auto-pause.js";
import { createCodexAutoPauseRecoverySummary } from "./codex-auto-pause-recovery-summary.js";
import type {
  BrowserIncomingMessage,
  CLIResultMessage,
  CodexOutboundTurn,
  TakodeHerdBatchSnapshot,
  ThreadRef,
} from "../session-types.js";
import { buildProgrammaticUserMessage } from "../session-pause.js";
import type { Session } from "./ws-bridge-session.js";
import type { BrowserTransportDeps, ProgrammaticUserMessageOptions } from "./browser-transport-controller.js";
import {
  beginRecoveryDeliveryTransferHandoff,
  deliverRecoveryDeliveryTransfer,
  type RecoveryDeliveryTransferDeps,
} from "./recovery-delivery-transfer.js";

interface CodexAutoPauseDeliveryDeps extends RecoveryDeliveryTransferDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  broadcastPendingCodexInputs: (session: Session) => void;
  persistSession: (session: Session) => void;
  getBrowserTransportDeps: () => BrowserTransportDeps;
}

interface ProgrammaticCodexAutoPauseDeliveryInput {
  content: string;
  agentSource?: { sessionId: string; sessionLabel?: string };
  takodeHerdBatch?: TakodeHerdBatchSnapshot;
  threadRoute?: { threadKey: string; questId?: string; threadRefs?: ThreadRef[] };
  options?: ProgrammaticUserMessageOptions;
}

export function handleCodexResultErrorAutoPause(
  session: Session,
  msg: CLIResultMessage,
  completedTurn: CodexOutboundTurn | null,
  deps: CodexAutoPauseDeliveryDeps,
  interrupted = false,
): Promise<void> | void {
  if (session.backendType !== "codex") return;
  if (interrupted) return;
  const activeBeforeResult = getActiveCodexResultErrorAutoPause(session);
  const outcome = noteCodexResultForAutoPause(session, msg, completedTurn, Date.now(), {
    retainPausedOwnerOnResume: true,
  });
  if (!outcome.changed) return;
  const swept = sweepCodexAutoPausedQueuedBacklog(session);
  if (swept.changed) {
    deps.broadcastPendingCodexInputs(session);
  }
  if (outcome.resumedNow) {
    return finishSuccessfulAutoPauseRecovery(session, activeBeforeResult, outcome.heldInputs ?? [], deps);
  }
  broadcastCodexResultErrorAutoPauseUpdate(session, deps);
  if (outcome.diagnostic) {
    const state = getActiveCodexResultErrorAutoPause(session);
    deps.broadcastToBrowsers(session, {
      type: "error",
      message: state ? buildCodexAutoPauseDiagnostic(state) : outcome.diagnostic,
    });
  }
  deps.persistSession(session);
}

export type CodexAutoPauseReleaseRequestStatus = "accepted" | "in_progress" | "stale";

export async function releaseCodexAutoPausedInputs(
  session: Session,
  pausedAt: number,
  deps: CodexAutoPauseDeliveryDeps,
): Promise<CodexAutoPauseReleaseRequestStatus> {
  if (session.backendType !== "codex" || !isCurrentAutoPauseSession(session, deps)) return "stale";
  const activePause = getActiveCodexResultErrorAutoPause(session);
  if (!activePause || activePause.pausedAt !== pausedAt) return "stale";
  if (activePause.releaseProgress?.status === "releasing") return "in_progress";

  const acceptedAt = Date.now();
  activePause.releaseProgress = { status: "releasing", acceptedAt };
  broadcastCodexResultErrorAutoPauseUpdate(session, deps);
  await finishSuccessfulAutoPauseRecovery(session, activePause, activePause.heldInputs, deps, {
    releasedReasonCode: "user_release_requested",
    explicitReleaseAcceptedAt: acceptedAt,
  });
  return "accepted";
}

export function handleRecoveredCodexAutoPauseSuccess(
  session: Session,
  completedTurn: CodexOutboundTurn,
  deps: CodexAutoPauseDeliveryDeps,
): Promise<void> | void {
  const activeBeforeResult = getActiveCodexResultErrorAutoPause(session);
  const outcome = noteCodexAutoPauseRecoverySuccess(session, completedTurn, true);
  if (!outcome.resumedNow) return;
  const swept = sweepCodexAutoPausedQueuedBacklog(session);
  if (swept.changed) deps.broadcastPendingCodexInputs(session);
  return finishSuccessfulAutoPauseRecovery(session, activeBeforeResult, outcome.heldInputs ?? [], deps);
}

async function finishSuccessfulAutoPauseRecovery(
  session: Session,
  activeBeforeResult: ReturnType<typeof getActiveCodexResultErrorAutoPause>,
  heldInputs: NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>>["heldInputs"],
  deps: CodexAutoPauseDeliveryDeps,
  options: {
    releasedReasonCode?: "user_release_requested";
    explicitReleaseAcceptedAt?: number;
  } = {},
): Promise<void> {
  if (!activeBeforeResult || !isCurrentAutoPauseSession(session, deps)) return;
  const capturedHeldInputs = structuredClone(heldInputs);
  const pauseSnapshot = snapshotAutoPauseForFailedHandoff(activeBeforeResult, capturedHeldInputs);
  if (capturedHeldInputs.length === 0) {
    session.state.codex_result_error_auto_pause = null;
    broadcastCodexResultErrorAutoPauseUpdate(session, deps);
    try {
      await deps.persistSessionImmediately(session);
    } catch (error) {
      if (!isCurrentAutoPauseSession(session, deps)) return;
      restoreAutoPauseAfterFailedHandoff(session, pauseSnapshot, capturedHeldInputs, options.explicitReleaseAcceptedAt);
      broadcastCodexResultErrorAutoPauseUpdate(session, deps);
      deps.broadcastToBrowsers(session, {
        type: "error",
        message: "Takode could not save the held-input release. The pause was kept so you can try again.",
      });
      deps.persistSession(session);
      console.error("[codex-auto-pause] Failed to persist empty held-input release:", error);
    }
    return;
  }
  const recoverySummary = createCodexAutoPauseRecoverySummary(
    session,
    activeBeforeResult,
    capturedHeldInputs,
    Date.now(),
    deps,
    options.releasedReasonCode,
  );
  const messages = materializeCodexAutoPausedInputsForDrain(capturedHeldInputs, recoverySummary.id);
  let transfers: Map<string, string>;
  try {
    transfers = await beginRecoveryDeliveryTransferHandoff(
      session,
      capturedHeldInputs.map((item, index) => ({
        sourceOwnerKind: "auto_pause" as const,
        sourceOwnerId: item.id,
        sourceOwnerCount: item.count,
        message: messages[index]!,
      })),
      {
        onSourceOwnersRemoved: () => {
          clearExplicitReleaseProgress(session, options.explicitReleaseAcceptedAt);
          broadcastCodexResultErrorAutoPauseUpdate(session, deps);
        },
      },
      deps,
    );
  } catch (err) {
    if (!isCurrentAutoPauseSession(session, deps)) return;
    const restoreResult = restoreAutoPauseAfterFailedHandoff(
      session,
      pauseSnapshot,
      capturedHeldInputs,
      options.explicitReleaseAcceptedAt,
    );
    if (restoreResult === "newer_release_in_progress") {
      // The first barrier already made these transfers durable. Do not roll an
      // older epoch over the newer accepted release; let normal ingress re-hold
      // the older payload behind that authoritative pause instead.
      const retainedTransfers = findCapturedRecoveryTransferIds(session, capturedHeldInputs, recoverySummary.id);
      if (retainedTransfers) {
        transfers = retainedTransfers;
        console.warn(
          "[codex-auto-pause] Continuing a durable held-input transfer after its older source-removal barrier failed; a newer release epoch remains authoritative.",
          err,
        );
      } else {
        deps.broadcastToBrowsers(session, {
          type: "error",
          message:
            "Takode kept the newer held-input release in progress, but an older saved delivery could not resume. Reconnect this session to retry its saved delivery safely.",
        });
        console.error("[codex-auto-pause] Missing durable transfer after overlapping release rollback:", err);
        return;
      }
    } else {
      broadcastCodexResultErrorAutoPauseUpdate(session, deps);
      deps.broadcastToBrowsers(session, {
        type: "error",
        message:
          options.explicitReleaseAcceptedAt !== undefined
            ? "Takode could not finish releasing the held inputs. Their saved delivery state was kept; try Release now again if the banner remains."
            : "Held automatic inputs remain paused because their recovery transfer could not be persisted.",
      });
      deps.persistSession(session);
      console.error("[codex-auto-pause] Failed to persist recovery delivery transfer:", err);
      return;
    }
  }
  for (const item of capturedHeldInputs) {
    if (!isCurrentAutoPauseSession(session, deps)) return;
    const transferId = transfers.get(item.id);
    if (transferId) await deliverRecoveryDeliveryTransfer(session, transferId, deps);
  }
}

function snapshotAutoPauseForFailedHandoff(
  state: NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>>,
  heldInputs: NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>>["heldInputs"],
): NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>> {
  const { releaseProgress: _releaseProgress, ...rest } = state;
  return { ...rest, heldInputs: [...heldInputs] };
}

type AutoPauseHandoffRestoreResult = "restored" | "newer_release_in_progress";

function restoreAutoPauseAfterFailedHandoff(
  session: Session,
  snapshot: NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>>,
  capturedHeldInputs: NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>>["heldInputs"],
  explicitReleaseAcceptedAt: number | undefined,
): AutoPauseHandoffRestoreResult {
  const current = session.state.codex_result_error_auto_pause;
  if (!current) {
    session.state.codex_result_error_auto_pause = { ...snapshot, heldInputs: [...capturedHeldInputs] };
    return "restored";
  }
  const newerReleaseInProgress =
    current.pausedAt !== snapshot.pausedAt && current.releaseProgress?.status === "releasing";
  if (newerReleaseInProgress) return "newer_release_in_progress";

  const currentIds = new Set(current.heldInputs.map((item) => item.id));
  current.heldInputs = [...capturedHeldInputs.filter((item) => !currentIds.has(item.id)), ...current.heldInputs];
  const samePauseRollback =
    current.family === snapshot.family &&
    current.fingerprint === snapshot.fingerprint &&
    current.lastErrorAt === snapshot.lastErrorAt &&
    current.totalMatchingErrors === snapshot.totalMatchingErrors;
  if (samePauseRollback) current.pausedAt = snapshot.pausedAt;
  if (explicitReleaseAcceptedAt === undefined || current.releaseProgress?.acceptedAt === explicitReleaseAcceptedAt) {
    delete current.releaseProgress;
  }
  return "restored";
}

function findCapturedRecoveryTransferIds(
  session: Session,
  capturedHeldInputs: NonNullable<ReturnType<typeof getActiveCodexResultErrorAutoPause>>["heldInputs"],
  recoverySummaryId: string,
): Map<string, string> | null {
  const transferIds = new Map<string, string>();
  for (const item of capturedHeldInputs) {
    const matches = session.recoveryDeliveryTransfers.filter(
      (transfer) =>
        transfer.sourceOwnerKind === "auto_pause" &&
        transfer.sourceOwnerId === item.id &&
        transfer.message.autoPauseRecoveries?.some(
          (link) => link.summaryId === recoverySummaryId && link.groupId === item.id,
        ),
    );
    if (matches.length !== 1) return null;
    transferIds.set(item.id, matches[0]!.id);
  }
  return transferIds;
}

function isCurrentAutoPauseSession(
  session: Session,
  deps: Pick<CodexAutoPauseDeliveryDeps, "isCurrentSession">,
): boolean {
  return deps.isCurrentSession?.(session) ?? true;
}

export function prepareProgrammaticCodexAutoPauseDelivery(
  session: Session,
  input: ProgrammaticCodexAutoPauseDeliveryInput,
  deps: Pick<CodexAutoPauseDeliveryDeps, "broadcastToBrowsers" | "persistSession">,
): { status: "deliver"; options?: ProgrammaticUserMessageOptions } | { status: "held" } {
  const effectiveOptions = resolveProgrammaticAutoPauseOptions(input.options, input.agentSource);
  const autoPause = getActiveCodexResultErrorAutoPause(session);
  const message = buildProgrammaticUserMessage({
    content: input.content,
    agentSource: input.agentSource,
    takodeHerdBatch: input.takodeHerdBatch,
    threadRoute: input.threadRoute,
    options: effectiveOptions,
  });
  if (!autoPause || !isAutomaticCodexAutoPauseInput(message)) {
    return { status: "deliver", options: effectiveOptions };
  }

  queueCodexAutoPausedInput(session, "programmatic", message);
  broadcastCodexResultErrorAutoPauseUpdate(session, deps);
  deps.persistSession(session);
  return { status: "held" };
}

function resolveProgrammaticAutoPauseOptions(
  options: ProgrammaticUserMessageOptions | undefined,
  agentSource: { sessionId: string; sessionLabel?: string } | undefined,
): ProgrammaticUserMessageOptions | undefined {
  if (!options) return undefined;
  if (!agentSource && options.bypassPause && !options.autoPauseSourceKind) {
    return { ...options, autoPauseSourceKind: "manual" };
  }
  return {
    ...options,
  };
}

function clearExplicitReleaseProgress(session: Session, acceptedAt: number | undefined): boolean {
  if (acceptedAt === undefined) return false;
  const state = session.state.codex_result_error_auto_pause;
  if (state?.releaseProgress?.acceptedAt !== acceptedAt) return false;
  delete state.releaseProgress;
  return true;
}

function broadcastCodexResultErrorAutoPauseUpdate(
  session: Session,
  deps: Pick<CodexAutoPauseDeliveryDeps, "broadcastToBrowsers">,
): void {
  const progress = getCodexAutoPauseRecoveryProgress(session);
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: {
      codex_result_error_auto_pause: session.state.codex_result_error_auto_pause ?? null,
      codex_result_error_auto_pause_recovery_progress: progress,
    },
  });
}
