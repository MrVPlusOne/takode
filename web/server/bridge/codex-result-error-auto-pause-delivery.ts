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
): Promise<void> {
  if (!activeBeforeResult || heldInputs.length === 0) {
    session.state.codex_result_error_auto_pause = null;
    broadcastCodexResultErrorAutoPauseUpdate(session, deps);
    deps.persistSession(session);
    return;
  }
  const capturedHeldInputs = [...heldInputs];
  const recoverySummary = createCodexAutoPauseRecoverySummary(
    session,
    activeBeforeResult,
    capturedHeldInputs,
    Date.now(),
    deps,
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
          broadcastCodexResultErrorAutoPauseUpdate(session, deps);
        },
      },
      deps,
    );
  } catch (err) {
    console.error("[codex-auto-pause] Failed to persist recovery delivery transfer:", err);
    deps.broadcastToBrowsers(session, {
      type: "error",
      message: "Held automatic inputs remain paused because their recovery transfer could not be persisted.",
    });
    deps.persistSession(session);
    return;
  }
  for (const item of capturedHeldInputs) {
    const transferId = transfers.get(item.id);
    if (transferId) await deliverRecoveryDeliveryTransfer(session, transferId, deps);
  }
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
