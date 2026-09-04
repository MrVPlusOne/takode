import { formatThreadMarker } from "../../shared/thread-routing.js";
import { determineCodexTurnSourceKind } from "../codex-result-error-auto-pause.js";
import { formatReplyContentForPreview } from "../../shared/reply-context.js";
import type { CodexOutboundTurn, PendingCodexInput } from "../session-types.js";
import { restoreQueuedNeedsInputResolutionNotices } from "./adapter-browser-routing-needs-input-reminder.js";
import { collectCodexAutoPauseRecoveryLinks } from "./codex-auto-pause-recovery-summary.js";
import { createCodexHistoryIncorporation } from "./codex-history-incorporation.js";
import {
  refreshLeaderThreadOutcomeReminder,
  THREAD_RESPONSE_REMINDER_SOURCE_ID,
} from "./leader-thread-outcome-validator.js";
import { buildCodexBatchMessageInputs, buildCodexPendingBatchRecoveryText } from "./codex-pending-start-batch.js";
import { restoreSessionMessagePreview } from "../user-message-classification.js";
import type {
  CodexRecoveryOrchestratorDeps,
  CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

export function refreshPendingCodexThreadOutcomeReminders(
  session: CodexRecoveryOrchestratorSessionLike,
  deps: Pick<CodexRecoveryOrchestratorDeps, "broadcastPendingCodexInputs" | "persistSession">,
  options: { inputIds?: readonly string[] } = {},
): { changed: boolean; removedInputIds: string[] } {
  const selectedIds = options.inputIds ? new Set(options.inputIds) : null;
  const removedInputIds: string[] = [];
  let changed = false;
  for (const input of session.pendingCodexInputs) {
    if (selectedIds ? !selectedIds.has(input.id) : !input.cancelable) continue;
    const isReminder = input.agentSource?.sessionId === THREAD_RESPONSE_REMINDER_SOURCE_ID;
    const guard = input.leaderThreadOutcomeReminderGuard;
    if (!isReminder && guard === undefined) continue;
    const refreshed = isReminder ? refreshLeaderThreadOutcomeReminder(session, guard) : null;
    if (!refreshed) {
      removedInputIds.push(input.id);
      changed = true;
      continue;
    }
    let deliveryContent = input.deliveryContent;
    if (deliveryContent !== undefined) {
      if (!deliveryContent.endsWith(input.content)) {
        removedInputIds.push(input.id);
        changed = true;
        continue;
      }
      const prefix = deliveryContent.slice(0, -input.content.length);
      const markerPattern = /\[thread:(?:main|q-\d+)\]\s*$/iu;
      if (!markerPattern.test(prefix)) {
        removedInputIds.push(input.id);
        changed = true;
        continue;
      }
      deliveryContent = `${prefix.replace(markerPattern, `${formatThreadMarker(refreshed.route.threadKey)} `)}${refreshed.content}`;
    }
    const routeChanged =
      input.threadKey !== refreshed.route.threadKey ||
      input.questId !== refreshed.route.questId ||
      JSON.stringify(input.threadRefs ?? []) !== JSON.stringify(refreshed.route.threadRefs ?? []);
    const contentChanged =
      input.content !== refreshed.content ||
      deliveryContent !== input.deliveryContent ||
      JSON.stringify(input.leaderThreadOutcomeReminderGuard) !== JSON.stringify(refreshed.guard);
    if (!routeChanged && !contentChanged) continue;
    input.content = refreshed.content;
    input.deliveryContent = deliveryContent;
    input.leaderThreadOutcomeReminderGuard = refreshed.guard;
    input.threadKey = refreshed.route.threadKey;
    input.questId = refreshed.route.questId;
    input.threadRefs = refreshed.route.threadRefs;
    if (session.lastMessagePreviewAt === input.timestamp) {
      session.lastUserMessage = formatReplyContentForPreview(input.content).slice(0, 80);
    }
    changed = true;
  }
  if (removedInputIds.length > 0) {
    const removed = new Set(removedInputIds);
    const removedInputs = session.pendingCodexInputs.filter((input) => removed.has(input.id));
    session.pendingCodexInputs = session.pendingCodexInputs.filter((input) => !removed.has(input.id));
    for (const input of removedInputs) restoreQueuedNeedsInputResolutionNotices(session, input.id);
    if (removedInputs.some((input) => session.lastMessagePreviewAt === input.timestamp)) {
      restoreSessionMessagePreview(session);
    }
  }
  if (changed) {
    deps.broadcastPendingCodexInputs(session);
    deps.persistSession(session);
  }
  return { changed, removedInputIds };
}

export function refreshDispatchableCodexStartTurn(
  session: CodexRecoveryOrchestratorSessionLike,
  turn: CodexOutboundTurn,
  deps: Pick<CodexRecoveryOrchestratorDeps, "formatVsCodeSelectionPrompt" | "persistSession">,
): boolean {
  if (turn.adapterMsg.type !== "codex_start_pending") return true;
  const inputIds = turn.pendingInputIds ?? [turn.userMessageId];
  const pendingById = new Map(session.pendingCodexInputs.map((input) => [input.id, input]));
  const retained = inputIds.map((id) => pendingById.get(id)).filter((input): input is PendingCodexInput => !!input);
  if (retained.length === 0) {
    const index = session.pendingCodexTurns.indexOf(turn);
    if (index >= 0) session.pendingCodexTurns.splice(index, 1);
    deps.persistSession(session);
    return false;
  }
  const retainedIds = retained.map((input) => input.id);
  const inputs = buildCodexBatchMessageInputs(retained);
  const payloadChanged =
    retainedIds.length !== inputIds.length ||
    retainedIds.some((id, index) => id !== inputIds[index]) ||
    JSON.stringify(inputs) !== JSON.stringify(turn.adapterMsg.inputs);
  if (!payloadChanged) return true;
  const historyIncorporation = createCodexHistoryIncorporation(retainedIds);
  turn.adapterMsg = {
    type: "codex_start_pending",
    pendingInputIds: retainedIds,
    inputs,
    clientUserMessageId: historyIncorporation.clientUserMessageId,
  };
  turn.userMessageId = retainedIds[0]!;
  turn.pendingInputIds = retainedIds;
  turn.userContent = buildCodexPendingBatchRecoveryText(retained, deps);
  turn.historyIncorporation = historyIncorporation;
  turn.historyTrackingUnknown = undefined;
  turn.updatedAt = Date.now();
  turn.autoPauseSourceKind = determineCodexTurnSourceKind(retained);
  turn.autoPauseRecoveryLinks = collectCodexAutoPauseRecoveryLinks(retained);
  turn.requiresFreshSuccessor = retained.some((input) => input.requireFreshSuccessor) || undefined;
  deps.persistSession(session);
  return true;
}
