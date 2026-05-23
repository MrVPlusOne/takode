import {
  isSystemSourceTag,
  isTimerReminderContent,
  isTimerSourceTag,
} from "./bridge/adapter-browser-routing-source-tags.js";
import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  CLIResultMessage,
  CodexAutoPauseHeldInput,
  CodexAutoPauseInputSourceKind,
  CodexPendingBatchInput,
  CodexOutboundTurn,
  CodexResultErrorAutoPauseState,
  CodexResultErrorFamily,
  PendingCodexInput,
  PausedInboundSource,
  SessionState,
} from "./session-types.js";

type BrowserUserMessage = Extract<BrowserOutgoingMessage, { type: "user_message" }>;

export const CODEX_RESULT_ERROR_AUTO_PAUSE_THRESHOLD = 3;
export const CODEX_RESULT_ERROR_AUTO_PAUSE_STREAK_WINDOW_MS = 10 * 60 * 1000;

export interface ClassifiedCodexResultError {
  family: CodexResultErrorFamily;
  fingerprint: string;
  message: string;
}

export interface CodexResultErrorAutoPauseSessionLike {
  state: Pick<SessionState, "codex_result_error_auto_pause">;
}

export interface CodexAutoPausedQueuedBacklogSessionLike extends CodexResultErrorAutoPauseSessionLike {
  pendingCodexInputs: PendingCodexInput[];
  pendingCodexTurns: CodexOutboundTurn[];
}

export function classifyCodexResultError(msg: CLIResultMessage): ClassifiedCodexResultError | null {
  if (!msg.is_error) return null;
  if (typeof msg.codex_turn_id !== "string" || !msg.codex_turn_id.trim()) return null;
  if (typeof msg.result !== "string") return null;

  const normalized = msg.result.toLowerCase();
  if (
    normalized.includes("stream disconnected before completion") &&
    normalized.includes("error sending request") &&
    normalized.includes("/responses")
  ) {
    return {
      family: "model_backend_stream_error",
      fingerprint: "model_backend_stream_error:responses",
      message: msg.result,
    };
  }

  return null;
}

export function getCodexTurnSourceKind(
  turn: Pick<CodexOutboundTurn, "autoPauseSourceKind"> | null | undefined,
): CodexAutoPauseInputSourceKind {
  return turn?.autoPauseSourceKind ?? "automatic";
}

export function determineCodexInputSourceKind(input: PendingCodexInput): CodexAutoPauseInputSourceKind {
  if (input.autoPauseSourceKind) return input.autoPauseSourceKind;
  return determineUserMessageSourceKind({
    type: "user_message",
    content: input.content,
    ...(input.agentSource ? { agentSource: input.agentSource } : {}),
    ...(input.takodeHerdBatch ? { takodeHerdBatch: input.takodeHerdBatch } : {}),
  });
}

export function determineCodexTurnSourceKind(inputs: readonly PendingCodexInput[]): CodexAutoPauseInputSourceKind {
  if (inputs.length === 0) return "automatic";
  return inputs.every((input) => determineCodexInputSourceKind(input) === "manual") ? "manual" : "automatic";
}

export function determineUserMessageSourceKind(msg: BrowserUserMessage): CodexAutoPauseInputSourceKind {
  if (msg.autoPauseSourceKind) return msg.autoPauseSourceKind;
  if (msg.inputSource === "composer") return "manual";
  if (msg.takodeHerdBatch) return "automatic";
  if (isTimerReminderContent(msg.content)) return "automatic";
  if (!msg.agentSource) return "automatic";
  if (isSystemSourceTag(msg.agentSource) || isTimerSourceTag(msg.agentSource)) return "automatic";
  if (msg.agentSource.sessionId === "herd-events") return "automatic";
  return "automatic";
}

export function isAutomaticCodexAutoPauseInput(msg: BrowserUserMessage): boolean {
  return determineUserMessageSourceKind(msg) === "automatic";
}

export function noteCodexResultForAutoPause(
  session: CodexResultErrorAutoPauseSessionLike,
  msg: CLIResultMessage,
  turn: Pick<CodexOutboundTurn, "autoPauseSourceKind"> | null | undefined,
  now = Date.now(),
): {
  changed: boolean;
  pausedNow: boolean;
  resumedNow: boolean;
  diagnostic?: string;
  heldInputs?: CodexAutoPauseHeldInput[];
} {
  const classified = classifyCodexResultError(msg);
  if (!classified) {
    if (!msg.is_error) {
      return clearCodexResultErrorAutoPauseAfterSuccess(session, getCodexTurnSourceKind(turn));
    }
    return { changed: false, pausedNow: false, resumedNow: false };
  }

  const sourceKind = getCodexTurnSourceKind(turn);
  const existing = session.state.codex_result_error_auto_pause ?? null;
  const sameFingerprint = existing?.fingerprint === classified.fingerprint;
  const withinWindow = !!existing && now - existing.lastErrorAt <= CODEX_RESULT_ERROR_AUTO_PAUSE_STREAK_WINDOW_MS;
  const priorHeld = existing?.heldInputs ?? [];
  const streak = sameFingerprint && withinWindow ? existing.streak + 1 : 1;
  const totalMatchingErrors = sameFingerprint ? existing.totalMatchingErrors + 1 : 1;
  const pausedAt = existing?.pausedAt ?? (streak >= CODEX_RESULT_ERROR_AUTO_PAUSE_THRESHOLD ? now : null);
  const wasPaused = !!existing?.pausedAt;
  const pausedNow = !wasPaused && !!pausedAt;
  const state: CodexResultErrorAutoPauseState = {
    family: classified.family,
    fingerprint: classified.fingerprint,
    streak,
    threshold: CODEX_RESULT_ERROR_AUTO_PAUSE_THRESHOLD,
    pausedAt,
    lastError: classified.message,
    lastErrorAt: now,
    lastSourceKind: sourceKind,
    totalMatchingErrors,
    heldInputs: priorHeld,
  };
  session.state.codex_result_error_auto_pause = state;
  return {
    changed: true,
    pausedNow,
    resumedNow: false,
    ...(pausedNow
      ? {
          diagnostic: buildCodexAutoPauseDiagnostic(state),
        }
      : {}),
  };
}

export function queueCodexAutoPausedInput(
  session: CodexResultErrorAutoPauseSessionLike,
  source: PausedInboundSource,
  message: BrowserUserMessage,
  now = Date.now(),
): CodexAutoPauseHeldInput | null {
  const state = getActiveCodexResultErrorAutoPause(session);
  if (!state) return null;
  const key = codexAutoPauseCoalesceKey(source, message);
  const existing = state.heldInputs.find((item) => codexAutoPauseCoalesceKey(item.source, item.message) === key);
  if (existing) {
    existing.count += 1;
    existing.lastQueuedAt = now;
    existing.message = message;
    return existing;
  }
  const item: CodexAutoPauseHeldInput = {
    id: `codex-auto-pause-${now}-${state.heldInputs.length + 1}`,
    queuedAt: now,
    lastQueuedAt: now,
    source,
    message,
    count: 1,
  };
  state.heldInputs.push(item);
  return item;
}

export function getActiveCodexResultErrorAutoPause(
  session: CodexResultErrorAutoPauseSessionLike | null | undefined,
): CodexResultErrorAutoPauseState | null {
  const state = session?.state.codex_result_error_auto_pause ?? null;
  return state?.pausedAt ? state : null;
}

export function getCodexAutoPauseHeldInputCount(state: CodexResultErrorAutoPauseState | null | undefined): number {
  return (state?.heldInputs ?? []).reduce((total, item) => total + Math.max(1, item.count), 0);
}

export function buildCodexAutoPauseDiagnostic(state: CodexResultErrorAutoPauseState): string {
  const heldCount = getCodexAutoPauseHeldInputCount(state);
  const heldSuffix =
    heldCount === 0 ? "No automatic inputs are currently held." : `${heldCount} automatic input(s) are held.`;
  return (
    `Automatic Codex input delivery paused after ${state.streak} consecutive backend stream errors. ` +
    `${heldSuffix} Send a direct composer message or explicit takode send after fixing the backend to test recovery.`
  );
}

export function materializeCodexAutoPausedInputsForDrain(
  heldInputs: readonly CodexAutoPauseHeldInput[],
): BrowserUserMessage[] {
  return heldInputs.map((item) => {
    if (item.count <= 1) return item.message;
    return {
      ...item.message,
      content:
        `[Takode auto-pause resumed: ${item.count} similar automatic inputs were coalesced while delivery was paused.]\n\n` +
        item.message.content,
    };
  });
}

export function sweepCodexAutoPausedQueuedBacklog(
  session: CodexAutoPausedQueuedBacklogSessionLike,
  now = Date.now(),
): { changed: boolean; heldInputCount: number; heldInputIds: string[] } {
  if (!getActiveCodexResultErrorAutoPause(session)) {
    return { changed: false, heldInputCount: 0, heldInputIds: [] };
  }

  const heldInputIds: string[] = [];
  const remainingInputs: PendingCodexInput[] = [];
  for (const input of session.pendingCodexInputs) {
    if (isEligibleQueuedAutomaticCodexInput(input)) {
      queueCodexAutoPausedInput(session, "programmatic", pendingCodexInputToAutoPauseMessage(input), now);
      heldInputIds.push(input.id);
      continue;
    }
    remainingInputs.push(input);
  }

  let changed = heldInputIds.length > 0;
  if (changed) {
    session.pendingCodexInputs = remainingInputs;
  }
  const prunedQueuedTurns = pruneHeldQueuedCodexStartPendingTurns(session);
  changed ||= prunedQueuedTurns;

  return {
    changed,
    heldInputCount: heldInputIds.length,
    heldInputIds,
  };
}

export function holdCodexAutoPausedQueuedBacklog<TSession extends CodexAutoPausedQueuedBacklogSessionLike>(
  session: TSession,
  deps: {
    broadcastPendingCodexInputs: (session: TSession) => void;
    broadcastToBrowsers: (session: TSession, msg: BrowserIncomingMessage) => void;
    persistSession: (session: TSession) => void;
  },
): boolean {
  const swept = sweepCodexAutoPausedQueuedBacklog(session);
  if (!swept.changed) return false;
  deps.broadcastPendingCodexInputs(session);
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { codex_result_error_auto_pause: session.state.codex_result_error_auto_pause ?? null },
  });
  deps.persistSession(session);
  return true;
}

function clearCodexResultErrorAutoPauseAfterSuccess(
  session: CodexResultErrorAutoPauseSessionLike,
  sourceKind: CodexAutoPauseInputSourceKind,
): { changed: boolean; pausedNow: false; resumedNow: boolean; heldInputs?: CodexAutoPauseHeldInput[] } {
  const existing = session.state.codex_result_error_auto_pause ?? null;
  if (!existing) return { changed: false, pausedNow: false, resumedNow: false };
  if (existing.pausedAt && sourceKind !== "manual") {
    return { changed: false, pausedNow: false, resumedNow: false };
  }
  const heldInputs = existing.pausedAt ? existing.heldInputs : [];
  session.state.codex_result_error_auto_pause = null;
  return {
    changed: true,
    pausedNow: false,
    resumedNow: !!existing.pausedAt,
    ...(heldInputs.length ? { heldInputs } : {}),
  };
}

function isEligibleQueuedAutomaticCodexInput(input: PendingCodexInput): boolean {
  return input.cancelable && determineCodexInputSourceKind(input) === "automatic";
}

function pendingCodexInputToAutoPauseMessage(input: PendingCodexInput): BrowserUserMessage {
  return {
    type: "user_message",
    content: input.content,
    // The original browser message id was recorded before Codex deferred
    // history commit. Reusing it during drain would trip ingress idempotency
    // and drop this uncommitted pending input.
    ...(input.imageRefs?.length ? { imageRefs: input.imageRefs } : {}),
    ...(input.deliveryContent ? { deliveryContent: input.deliveryContent } : {}),
    ...(input.replyContext ? { replyContext: input.replyContext } : {}),
    ...(input.vscodeSelection ? { vscodeSelection: input.vscodeSelection } : {}),
    ...(input.agentSource ? { agentSource: input.agentSource } : {}),
    ...(input.takodeHerdBatch ? { takodeHerdBatch: input.takodeHerdBatch } : {}),
    ...(input.threadKey ? { threadKey: input.threadKey } : {}),
    ...(input.questId ? { questId: input.questId } : {}),
    ...(input.threadRefs ? { threadRefs: input.threadRefs } : {}),
    ...(input.autoPauseSourceKind ? { autoPauseSourceKind: input.autoPauseSourceKind } : {}),
  };
}

function pruneHeldQueuedCodexStartPendingTurns(session: CodexAutoPausedQueuedBacklogSessionLike): boolean {
  const pendingById = new Map(session.pendingCodexInputs.map((input) => [input.id, input]));
  let changed = false;

  for (let idx = session.pendingCodexTurns.length - 1; idx >= 0; idx--) {
    const turn = session.pendingCodexTurns[idx];
    if (!turn || !isQueuedCodexStartPendingTurn(turn)) continue;
    const ids = turn.pendingInputIds ?? [turn.userMessageId];
    const retainedInputs = ids.map((id) => pendingById.get(id)).filter((input): input is PendingCodexInput => !!input);
    if (retainedInputs.length === ids.length) continue;

    changed = true;
    if (retainedInputs.length === 0) {
      session.pendingCodexTurns.splice(idx, 1);
      continue;
    }

    turn.adapterMsg = {
      type: "codex_start_pending",
      pendingInputIds: retainedInputs.map((input) => input.id),
      inputs: buildQueuedCodexBatchMessageInputs(retainedInputs),
    };
    turn.userMessageId = retainedInputs[0].id;
    turn.pendingInputIds = retainedInputs.map((input) => input.id);
    turn.userContent = buildQueuedCodexPendingBatchText(retainedInputs);
    turn.autoPauseSourceKind = determineCodexTurnSourceKind(retainedInputs);
    turn.updatedAt = Date.now();
    turn.lastError = null;
  }

  return changed;
}

function isQueuedCodexStartPendingTurn(turn: CodexOutboundTurn): boolean {
  return (
    (turn.status === "queued" || turn.status === "blocked_broken_session") &&
    turn.turnId == null &&
    turn.adapterMsg.type === "codex_start_pending"
  );
}

function buildQueuedCodexBatchMessageInputs(inputs: PendingCodexInput[]): CodexPendingBatchInput[] {
  return inputs.map((input) => ({
    content: input.deliveryContent || input.content,
    ...(input.vscodeSelection ? { vscodeSelection: input.vscodeSelection } : {}),
  }));
}

function buildQueuedCodexPendingBatchText(inputs: PendingCodexInput[]): string {
  return inputs
    .map((input) => input.deliveryContent || input.content)
    .filter(Boolean)
    .join("\n\n");
}

function codexAutoPauseCoalesceKey(source: PausedInboundSource, message: BrowserUserMessage): string {
  const agent = message.agentSource?.sessionId ?? "";
  const thread = message.threadKey ?? message.questId ?? "";
  const herd = message.takodeHerdBatch?.eventKeys?.join(",") ?? "";
  return [source, agent, thread, herd, message.content.trim()].join("\u0000");
}
