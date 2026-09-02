import type { CodexOutboundTurn, CodexPendingBatchInput, PendingCodexInput } from "../session-types.js";
import { isCodexTurnProvablyNeverDispatched } from "./codex-history-incorporation.js";

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
