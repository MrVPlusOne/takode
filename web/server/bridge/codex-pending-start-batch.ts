import type { CodexOutboundTurn, CodexPendingBatchInput, PendingCodexInput } from "../session-types.js";
import { isCodexTurnProvablyNeverDispatched } from "./codex-history-incorporation.js";
import { COMPACTION_RECOVERY_SOURCE_ID } from "../../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "../session-types.js";

/** Retire only provably unsent recovery bundles superseded by a later boundary. */
export function pruneSupersededCompactionInputs(session: {
  messageHistory: BrowserIncomingMessage[];
  pendingCodexInputs: PendingCodexInput[];
  pendingCodexTurns: CodexOutboundTurn[];
  codexAdapter?: { hasNativeCompactionRecovery?: () => boolean } | null;
}): boolean {
  const marker = session.messageHistory.findLast((entry) => entry.type === "compact_marker");
  const nativeContext = session.codexAdapter?.hasNativeCompactionRecovery?.() === true;
  if (!nativeContext && marker?.type !== "compact_marker") return false;
  const protectedIds = new Set(
    session.pendingCodexTurns
      .filter((turn) => turn.status !== "completed" && !isCodexTurnProvablyNeverDispatched(turn))
      .flatMap((turn) => turn.pendingInputIds ?? [turn.userMessageId]),
  );
  const retained = session.pendingCodexInputs.filter(
    (input) =>
      input.agentSource?.sessionId !== COMPACTION_RECOVERY_SOURCE_ID ||
      (!nativeContext && marker?.type === "compact_marker" && input.timestamp >= marker.timestamp) ||
      !input.cancelable ||
      protectedIds.has(input.id),
  );
  if (retained.length === session.pendingCodexInputs.length) return false;
  session.pendingCodexInputs = retained;
  return true;
}

/** Human/leader input brings preceding observations along, but not later background work. */
export function selectCodexSteeringInputs(inputs: PendingCodexInput[]): PendingCodexInput[] {
  const eligible = inputs.filter((input) => input.cancelable && input.deliveryState !== "failed");
  const lastTrigger = eligible.findLastIndex((input) => {
    const source = input.agentSource?.sessionId;
    return !source || (!source.startsWith("system") && !source.startsWith("herd") && !source.startsWith("timer:"));
  });
  return eligible.slice(0, lastTrigger + 1);
}

export function buildCodexBatchMessageInputs(inputs: PendingCodexInput[]): CodexPendingBatchInput[] {
  return inputs.map((input) => ({
    content: input.deliveryContent || input.content,
    ...(input.vscodeSelection ? { vscodeSelection: input.vscodeSelection } : {}),
  }));
}

export function buildCodexPendingBatchRecoveryText(
  inputs: PendingCodexInput[],
  deps: {
    formatVsCodeSelectionPrompt: (selection: NonNullable<PendingCodexInput["vscodeSelection"]>) => string;
  },
): string {
  return inputs
    .map((input) => {
      const parts = [input.deliveryContent || input.content];
      if (input.vscodeSelection) parts.push(deps.formatVsCodeSelectionPrompt(input.vscodeSelection));
      return parts.filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function findQueuedCodexPendingStartBatchTurn(turns: CodexOutboundTurn[]): CodexOutboundTurn | null {
  return (
    turns.find(
      (turn) =>
        !turn.providerRecoveryFamily &&
        turn.adapterMsg.type === "codex_start_pending" &&
        isCodexTurnProvablyNeverDispatched(turn),
    ) ?? null
  );
}

export function getQueuedCodexPendingBatchInputs(
  pendingInputs: PendingCodexInput[],
  turns: CodexOutboundTurn[],
  mutableQueuedBatch: CodexOutboundTurn | null,
): PendingCodexInput[] {
  const coveredIds = new Set<string>();
  for (const turn of turns) {
    if (turn === mutableQueuedBatch || turn.status === "completed") continue;
    for (const id of turn.pendingInputIds ?? [turn.userMessageId]) coveredIds.add(id);
  }
  const deliverable = pendingInputs.filter(
    (input) => input.cancelable && input.deliveryState !== "failed" && !coveredIds.has(input.id),
  );
  const priority = deliverable.find((input) => input.queueBeforeOwnerId);
  return priority ? [priority] : deliverable;
}
