import type { CodexResumeSnapshot } from "../codex-adapter.js";
import { recordCodexPendingDeliveryProofSignal } from "../codex-pending-delivery-diagnostics.js";
import type { BrowserIncomingMessage, CodexOutboundTurn, PendingCodexInput } from "../session-types.js";
import {
  getMessageAtAbsoluteHistoryIndex,
  type CodexLocalDeliveryActivitySummary,
} from "./codex-delivery-ownership.js";

type ProofSignalSession = {
  codexPendingDeliveryProofSignals?: import("../session-types.js").CodexPendingDeliveryProofSignal[];
};

export function recordCodexTurnResultProof(session: ProofSignalSession, turnId: string): void {
  recordCodexPendingDeliveryProofSignal(session, {
    kind: "turn_result",
    turnId,
  });
}

export function recordCodexResumeSnapshotProof(session: ProofSignalSession, snapshot: CodexResumeSnapshot): void {
  recordCodexPendingDeliveryProofSignal(session, {
    kind: "resume_snapshot",
    turnId: typeof snapshot.lastTurn?.id === "string" ? snapshot.lastTurn.id : null,
    threadStatus: typeof snapshot.threadStatus === "string" ? snapshot.threadStatus : null,
    turnStatus: typeof snapshot.lastTurn?.status === "string" ? snapshot.lastTurn.status : null,
    classification: classifyResumeSnapshotProof(snapshot),
  });
}

export function recordCodexTurnStartedProof(session: ProofSignalSession, turnId: string): void {
  recordCodexPendingDeliveryProofSignal(session, {
    kind: "turn_started",
    turnId,
  });
}

export function recordCodexTurnSteeredProof(
  session: ProofSignalSession,
  turnId: string,
  pendingInputCount: number,
): void {
  recordCodexPendingDeliveryProofSignal(session, {
    kind: "turn_steered",
    turnId,
    pendingInputCount,
  });
}

export function recordCodexTurnSteerFailedProof(
  session: ProofSignalSession,
  turnId: string | null,
  pendingInputCount: number,
): void {
  recordCodexPendingDeliveryProofSignal(session, {
    kind: "turn_steer_failed",
    turnId,
    pendingInputCount,
  });
}

export function summarizePendingCodexInputs(inputs: PendingCodexInput[]): Array<Record<string, unknown>> {
  return inputs.map((input) => ({
    id: input.id,
    cancelable: input.cancelable,
    contentBytes: Buffer.byteLength(input.content || "", "utf-8"),
    hasImages: Array.isArray(input.imageRefs) && input.imageRefs.length > 0,
    timestamp: input.timestamp,
  }));
}

export function summarizePendingCodexTurns(turns: CodexOutboundTurn[]): Array<Record<string, unknown>> {
  return turns.map((turn) => ({
    userMessageId: turn.userMessageId,
    turnId: turn.turnId ?? null,
    status: turn.status,
    turnTarget: turn.turnTarget ?? null,
    dispatchCount: turn.dispatchCount,
    pendingInputIds: turn.pendingInputIds ?? null,
    disconnectedAt: turn.disconnectedAt ?? null,
    resumeConfirmedAt: turn.resumeConfirmedAt ?? null,
    updatedAt: turn.updatedAt,
  }));
}

export function summarizeCodexResumeSnapshot(snapshot: unknown): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const rec = snapshot as {
    threadId?: unknown;
    threadStatus?: unknown;
    turnCount?: unknown;
    lastTurn?: { id?: unknown; status?: unknown; items?: unknown[] } | null;
  };
  return {
    threadId: typeof rec.threadId === "string" ? rec.threadId : null,
    threadStatus: typeof rec.threadStatus === "string" ? rec.threadStatus : null,
    turnCount: typeof rec.turnCount === "number" ? rec.turnCount : null,
    lastTurn: rec.lastTurn
      ? {
          id: typeof rec.lastTurn.id === "string" ? rec.lastTurn.id : null,
          status: typeof rec.lastTurn.status === "string" ? rec.lastTurn.status : null,
          itemTypes: Array.isArray(rec.lastTurn.items)
            ? rec.lastTurn.items.map((item) =>
                item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string"
                  ? (item as { type: string }).type
                  : "unknown",
              )
            : [],
        }
      : null,
  };
}

function classifyResumeSnapshotProof(snapshot: CodexResumeSnapshot): string {
  const threadStatus = snapshot.threadStatus ?? null;
  const turnStatus = snapshot.lastTurn?.status ?? null;
  if (threadStatus === "idle" && turnStatus === "inProgress") return "idle_thread_inprogress_last_turn";
  if (threadStatus === "idle") return "idle_thread";
  if (turnStatus === "inProgress") return "active_inprogress_last_turn";
  if (turnStatus) return `last_turn_${turnStatus}`;
  return "no_last_turn";
}

export function recordCodexReplaySuppressedProof(
  session: ProofSignalSession & {
    messageHistory: BrowserIncomingMessage[];
    _frozenCount?: number;
  },
  pending: CodexOutboundTurn,
  replayCause: string,
  activity: CodexLocalDeliveryActivitySummary,
): void {
  const source = getMessageAtAbsoluteHistoryIndex(session, pending.historyIndex);
  const route = source?.type === "user_message" ? (source.threadKey ?? "main") : "unknown";
  const quest = source?.type === "user_message" ? (source.questId ?? "none") : "unknown";
  const historyRange = `${activity.firstHistoryIndex ?? "none"}-${activity.lastHistoryIndex ?? "none"}`;
  recordCodexPendingDeliveryProofSignal(session, {
    kind: "resume_snapshot",
    turnId: pending.turnId,
    pendingInputCount: pending.pendingInputIds?.length ?? 1,
    classification: [
      "retry_suppressed_model_activity",
      `cause=${replayCause}`,
      `owner=${pending.userMessageId}`,
      `delivery=${pending.status}`,
      `history=${pending.historyIndex}`,
      `activity=${activity.kinds.join(",") || "unknown"}`,
      `count=${activity.count}`,
      `range=${historyRange}`,
      `route=${route}`,
      `quest=${quest}`,
    ].join(";"),
  });
}
