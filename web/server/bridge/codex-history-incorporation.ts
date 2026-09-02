import { randomUUID } from "node:crypto";
import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import type { CodexResumeSnapshot, CodexResumeTurnSnapshot } from "../codex-adapter.js";
import type {
  CodexHistoryIncorporationState,
  CodexHistoryPresence,
  CodexTerminalHistoryReconciliation,
  CodexTurnRecoveryContinuationMode,
} from "../codex-outbound-turn-types.js";
import {
  summarizeLocalCodexDeliveryActivityFrom,
  type CodexDeliveryHistoryLike,
  type CodexLocalDeliveryActivitySummary,
} from "./codex-delivery-ownership.js";

export interface CodexHistoryIncorporationEvidence {
  presence: CodexHistoryPresence;
  reason: string;
  turn: CodexResumeTurnSnapshot | null;
  /** All turns implicated by ambiguous receipt evidence, used only for terminal safety checks. */
  candidateTurns: CodexResumeTurnSnapshot[];
  receiptItemIndex: number | null;
  activityItems: Array<Record<string, unknown>>;
  completeItems: boolean;
}

export function createCodexHistoryIncorporation(inputIds: string[]): CodexHistoryIncorporationState {
  const batchId = `${randomUUID()}-${inputIds[0] ?? "batch"}`;
  return {
    batchId,
    inputIds: [...inputIds],
    historyIndexes: inputIds.map(() => null),
    attempt: 0,
    clientUserMessageId: clientIdForAttempt(batchId, 0),
    providerTurnId: null,
    rpcAcceptedAt: null,
    recordedAt: null,
    recordedSource: null,
    activityStartHistoryIndex: null,
  };
}

export function createCodexHistoryIncorporationForClient(
  inputIds: string[],
  clientUserMessageId: string,
): CodexHistoryIncorporationState | null {
  const match = clientUserMessageId.match(/^(.+):([01])$/);
  if (!match) return null;
  const batchId = match[1]!;
  const attempt = Number(match[2]) as 0 | 1;
  return {
    batchId,
    inputIds: [...inputIds],
    historyIndexes: inputIds.map(() => null),
    attempt,
    clientUserMessageId,
    providerTurnId: null,
    rpcAcceptedAt: null,
    recordedAt: null,
    recordedSource: null,
    activityStartHistoryIndex: null,
  };
}

export function clientUserMessageIdForTurn(turn: CodexOutboundTurn): string | null {
  const tracked = turn.historyIncorporation?.clientUserMessageId;
  if (tracked?.trim()) return tracked;
  const value = (turn.adapterMsg as { clientUserMessageId?: unknown }).clientUserMessageId;
  return nonEmptyString(value);
}

export function normalizeCodexHistoryIncorporation(
  turn: CodexOutboundTurn,
): CodexHistoryIncorporationState | undefined {
  const raw = turn.historyIncorporation;
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as unknown as Record<string, unknown>;
  const batchId = nonEmptyString(record.batchId);
  const inputIds = nonEmptyStringArray(record.inputIds);
  const historyIndexes = nullableIndexArray(record.historyIndexes, inputIds?.length ?? 0);
  const attempt = record.attempt === 0 || record.attempt === 1 ? record.attempt : null;
  const clientUserMessageId = nonEmptyString(record.clientUserMessageId);
  const adapterClientUserMessageId = nonEmptyString(
    (turn.adapterMsg as { clientUserMessageId?: unknown }).clientUserMessageId,
  );
  const expectedInputIds = turn.pendingInputIds ?? [turn.userMessageId];
  const providerTurnId = nonEmptyString(record.providerTurnId);
  const restoredTurnId = nonEmptyString(turn.turnId);
  const rpcAcceptedAt = finiteNumberOrNull(record.rpcAcceptedAt);
  const recordedAt = finiteNumberOrNull(record.recordedAt);
  const recordedSource =
    record.recordedSource === "live" || record.recordedSource === "resume_snapshot" ? record.recordedSource : null;
  const activityStartHistoryIndex = nonNegativeIntegerOrNull(record.activityStartHistoryIndex);
  if (
    !batchId ||
    !inputIds ||
    !historyIndexes ||
    attempt == null ||
    clientUserMessageId !== clientIdForAttempt(batchId, attempt) ||
    !sameOrderedIds(inputIds, expectedInputIds) ||
    clientUserMessageId !== adapterClientUserMessageId ||
    new Set(inputIds).size !== inputIds.length ||
    (!!providerTurnId && !!restoredTurnId && providerTurnId !== restoredTurnId) ||
    (rpcAcceptedAt != null && !providerTurnId) ||
    (recordedAt != null) !== (recordedSource != null) ||
    (activityStartHistoryIndex != null && recordedAt == null)
  ) {
    return undefined;
  }
  return {
    batchId,
    inputIds,
    historyIndexes,
    attempt,
    clientUserMessageId,
    providerTurnId,
    rpcAcceptedAt,
    recordedAt,
    recordedSource,
    activityStartHistoryIndex,
  };
}

export function isCodexTurnProvablyNeverDispatched(turn: CodexOutboundTurn): boolean {
  if (turn.status !== "queued" && turn.status !== "blocked_broken_session") return false;
  if (turn.historyTrackingUnknown === true || turn.terminalHistoryReconciliation) return false;
  if (turn.dispatchCount !== 0 || turn.turnId != null || turn.acknowledgedAt != null) return false;
  if (turn.providerReplayUnsafeActivityObserved) return false;
  const history = turn.historyIncorporation;
  if (!history) return true;
  const normalized = normalizeCodexHistoryIncorporation(turn);
  return (
    normalized != null &&
    normalized.attempt === 0 &&
    normalized.providerTurnId == null &&
    normalized.rpcAcceptedAt == null &&
    normalized.recordedAt == null
  );
}

export function prepareCodexHistoryTrackingForDispatch(turn: CodexOutboundTurn | null, receiptAware: boolean): boolean {
  if (!turn || turn.adapterMsg.type !== "codex_start_pending" || !isCodexTurnProvablyNeverDispatched(turn)) {
    return false;
  }
  if (!receiptAware) {
    if (!turn.historyIncorporation && !turn.adapterMsg.clientUserMessageId) return false;
    turn.historyIncorporation = undefined;
    turn.historyTrackingUnknown = undefined;
    delete turn.adapterMsg.clientUserMessageId;
    return true;
  }
  if (turn.historyIncorporation) return false;
  const inputIds = turn.pendingInputIds ?? [turn.userMessageId];
  const historyIncorporation = createCodexHistoryIncorporation(inputIds);
  turn.pendingInputIds = inputIds;
  turn.adapterMsg = {
    ...turn.adapterMsg,
    pendingInputIds: inputIds,
    clientUserMessageId: historyIncorporation.clientUserMessageId,
  };
  turn.historyIncorporation = historyIncorporation;
  turn.historyTrackingUnknown = undefined;
  return true;
}

export function normalizeCodexTerminalHistoryReconciliation(
  value: unknown,
): CodexTerminalHistoryReconciliation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const presence =
    record.presence === "present" || record.presence === "absent" || record.presence === "unknown"
      ? record.presence
      : null;
  const action =
    record.action === "complete" ||
    record.action === "replay" ||
    record.action === "continue" ||
    record.action === "action_required"
      ? record.action
      : null;
  const continuationMode =
    record.continuationMode === "finish_response" || record.continuationMode === "verify_then_continue"
      ? record.continuationMode
      : record.continuationMode === null
        ? null
        : undefined;
  const reason = nonEmptyString(record.reason);
  const classifiedAt = finiteNumberOrNull(record.classifiedAt);
  if (!presence || !action || continuationMode === undefined || !reason || classifiedAt == null) return undefined;
  if ((action === "continue") !== (continuationMode != null)) return undefined;
  if (action === "action_required" && continuationMode != null) return undefined;
  if (action === "replay" && presence !== "absent") return undefined;
  if (action === "complete" && presence !== "present") return undefined;
  return { presence, reason, action, continuationMode, classifiedAt };
}

export function stageCodexTerminalHistoryReconciliation(
  turn: CodexOutboundTurn,
  plan: CodexTerminalHistoryReconciliation,
): void {
  turn.terminalHistoryReconciliation = plan;
  turn.status = "recovery_pending";
  turn.turnTarget = null;
  turn.lastError = null;
  turn.updatedAt = plan.classifiedAt;
}

export function markCodexHistoryRpcAccepted(
  turn: CodexOutboundTurn,
  providerTurnId: string,
  acceptedAt = Date.now(),
): boolean {
  const state = turn.historyIncorporation;
  if (!state || state.clientUserMessageId !== clientUserMessageIdForTurn(turn)) return false;
  const changed = state.providerTurnId !== providerTurnId || state.rpcAcceptedAt !== acceptedAt;
  state.providerTurnId = providerTurnId;
  state.rpcAcceptedAt = acceptedAt;
  return changed;
}

export function markCodexHistoryRecorded(
  turn: CodexOutboundTurn,
  source: "live" | "resume_snapshot",
  activityStartHistoryIndex: number | null,
  recordedAt = Date.now(),
): boolean {
  const state = turn.historyIncorporation;
  if (!state) return false;
  const changed =
    state.recordedAt == null ||
    state.recordedSource == null ||
    (activityStartHistoryIndex != null && state.activityStartHistoryIndex == null);
  state.recordedAt ??= recordedAt;
  state.recordedSource ??= source;
  if (activityStartHistoryIndex != null) state.activityStartHistoryIndex ??= activityStartHistoryIndex;
  return changed;
}

export function beginCodexHistoryAbsentReplay(turn: CodexOutboundTurn): boolean {
  const state = turn.historyIncorporation;
  if (!state || state.recordedAt != null || state.attempt >= 1) return false;
  state.attempt = 1;
  state.clientUserMessageId = clientIdForAttempt(state.batchId, 1);
  state.providerTurnId = null;
  state.rpcAcceptedAt = null;
  state.recordedAt = null;
  state.recordedSource = null;
  state.activityStartHistoryIndex = null;
  if (turn.adapterMsg.type === "codex_start_pending" || turn.adapterMsg.type === "codex_steer_pending") {
    turn.adapterMsg.clientUserMessageId = state.clientUserMessageId;
  }
  turn.providerReplayUnsafeActivityObserved = undefined;
  return true;
}

export function inspectCodexHistoryIncorporation(
  snapshot: CodexResumeSnapshot,
  turn: CodexOutboundTurn,
): CodexHistoryIncorporationEvidence | null {
  const state = normalizeCodexHistoryIncorporation(turn);
  if (!state) return null;
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : snapshot.lastTurn ? [snapshot.lastTurn] : [];
  const matches: Array<{ turn: CodexResumeTurnSnapshot; index: number }> = [];
  for (const candidate of turns) {
    candidate.items.forEach((item, index) => {
      if (codexUserMessageClientId(item) === state.clientUserMessageId) matches.push({ turn: candidate, index });
    });
  }
  const expectedTurnId = state.providerTurnId ?? turn.turnId;
  const expectedTurn = expectedTurnId ? (turns.find((item) => item.id === expectedTurnId) ?? null) : null;
  if (matches.length > 1) {
    return unknownEvidence("duplicate_receipt", [...matches.map((match) => match.turn), expectedTurn]);
  }
  if (matches.length === 1) {
    const match = matches[0]!;
    if (state.providerTurnId && match.turn.id !== state.providerTurnId) {
      return unknownEvidence("receipt_turn_mismatch", [match.turn, expectedTurn]);
    }
    const completeItems = match.turn.itemsView === "full";
    return {
      presence: "present",
      reason: completeItems ? "receipt" : `receipt_${match.turn.itemsView ?? "unknown_view"}`,
      turn: match.turn,
      candidateTurns: [match.turn],
      receiptItemIndex: match.index,
      activityItems: match.turn.items.slice(match.index + 1),
      completeItems,
    };
  }
  if (state.recordedAt != null) return unknownEvidence("live_receipt_missing_from_snapshot", [expectedTurn]);
  const candidate = expectedTurn;
  if (!candidate) return unknownEvidence("turn_not_loaded");
  if (candidate.itemsView !== "full") {
    return {
      ...unknownEvidence(candidate.itemsView ? `items_${candidate.itemsView}` : "items_view_missing", [candidate]),
      turn: candidate,
    };
  }
  if (candidate.items.some(isContextCompactionItem)) {
    return { ...unknownEvidence("compacted_turn", [candidate]), turn: candidate };
  }
  if (normalizeStatus(candidate.status) === "inprogress" && normalizeStatus(snapshot.threadStatus) !== "idle") {
    return { ...unknownEvidence("turn_still_active", [candidate]), turn: candidate };
  }
  return {
    presence: "absent",
    reason: "full_turn_without_receipt",
    turn: candidate,
    candidateTurns: [candidate],
    receiptItemIndex: null,
    activityItems: [],
    completeItems: true,
  };
}

export function summarizeHistoryCorrelatedLocalActivity(
  session: CodexDeliveryHistoryLike,
  turn: CodexOutboundTurn,
): CodexLocalDeliveryActivitySummary {
  const start = turn.historyIncorporation?.activityStartHistoryIndex;
  return start == null ? emptyActivity() : summarizeLocalCodexDeliveryActivityFrom(session, start, turn.userMessageId);
}

export function chooseCodexRecoveryContinuationMode(input: {
  evidence: CodexHistoryIncorporationEvidence;
  activity: CodexLocalDeliveryActivitySummary;
  omittedToolResultCount?: number;
}): CodexTurnRecoveryContinuationMode {
  if (!input.evidence.completeItems || (input.omittedToolResultCount ?? 0) > 0) return "verify_then_continue";
  if (input.activity.kinds.some((kind) => kind !== "reasoning" && kind !== "assistant_text")) {
    return "verify_then_continue";
  }
  return input.evidence.activityItems.some(isEffectCapableOrUnknownItem) ? "verify_then_continue" : "finish_response";
}

export function mergeCodexHistoryIncorporation(keeper: CodexOutboundTurn, duplicate: CodexOutboundTurn): void {
  const left = keeper.historyIncorporation;
  const right = duplicate.historyIncorporation;
  if (!right) return;
  if (!left) {
    keeper.historyIncorporation = {
      ...right,
      inputIds: [...right.inputIds],
      historyIndexes: [...right.historyIndexes],
    };
    return;
  }
  if (
    left.batchId !== right.batchId ||
    left.attempt !== right.attempt ||
    left.clientUserMessageId !== right.clientUserMessageId ||
    !sameOrderedIds(left.inputIds, right.inputIds)
  ) {
    return;
  }
  left.providerTurnId ??= right.providerTurnId;
  left.historyIndexes = left.historyIndexes.map((value, index) => value ?? right.historyIndexes[index] ?? null);
  left.rpcAcceptedAt ??= right.rpcAcceptedAt;
  left.recordedAt ??= right.recordedAt;
  left.recordedSource ??= right.recordedSource;
  left.activityStartHistoryIndex ??= right.activityStartHistoryIndex;
}

export function codexHistoryMilestone(
  turn: CodexOutboundTurn,
): "untracked" | "submitted" | "rpc_accepted" | "recorded" {
  const state = turn.historyIncorporation;
  if (!state) return "untracked";
  if (state.recordedAt != null) return "recorded";
  if (state.rpcAcceptedAt != null) return "rpc_accepted";
  return "submitted";
}

export function absoluteHistoryEnd(session: {
  messageHistory: BrowserIncomingMessage[];
  _frozenCount?: number;
}): number {
  return (session._frozenCount ?? 0) + session.messageHistory.length;
}

function clientIdForAttempt(batchId: string, attempt: 0 | 1): string {
  return `${batchId}:${attempt}`;
}

function codexUserMessageClientId(item: Record<string, unknown>): string | null {
  if (normalizeItemType(item.type) !== "usermessage") return null;
  return nonEmptyString(item.clientId ?? item.client_id);
}

function isContextCompactionItem(item: Record<string, unknown>): boolean {
  return normalizeItemType(item.type) === "contextcompaction";
}

function isEffectCapableOrUnknownItem(item: Record<string, unknown>): boolean {
  const type = normalizeItemType(item.type);
  return type !== "reasoning" && type !== "agentmessage" && type !== "usermessage";
}

function normalizeItemType(value: unknown): string {
  return typeof value === "string" ? value.replace(/[_-]/g, "").toLowerCase() : "";
}

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.replace(/[_-]/g, "").toLowerCase() : "";
}

function unknownEvidence(
  reason: string,
  candidates: Array<CodexResumeTurnSnapshot | null> = [],
): CodexHistoryIncorporationEvidence {
  const candidateTurns = [...new Map(candidates.filter(Boolean).map((turn) => [turn!.id, turn!])).values()];
  return {
    presence: "unknown",
    reason,
    turn: null,
    candidateTurns,
    receiptItemIndex: null,
    activityItems: [],
    completeItems: false,
  };
}

function emptyActivity(): CodexLocalDeliveryActivitySummary {
  return { count: 0, kinds: [], firstHistoryIndex: null, lastHistoryIndex: null };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonEmptyStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !nonEmptyString(item))) return null;
  return [...value] as string[];
}

function nullableIndexArray(value: unknown, length: number): Array<number | null> | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  if (value.some((item) => item !== null && (!Number.isInteger(item) || (item as number) < 0))) return null;
  return [...value] as Array<number | null>;
}

function sameOrderedIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
