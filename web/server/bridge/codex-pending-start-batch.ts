import type { CodexOutboundTurn, CodexPendingBatchInput, PendingCodexInput } from "../session-types.js";

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
        turn.status === "queued" &&
        turn.turnId == null &&
        turn.adapterMsg.type === "codex_start_pending",
    ) ?? null
  );
}

export function getQueuedCodexPendingBatchInputs(
  pendingInputs: PendingCodexInput[],
  head: CodexOutboundTurn | null,
): PendingCodexInput[] {
  const coveredIds = new Set<string>();
  const mutableQueuedBatch =
    head &&
    !head.providerRecoveryFamily &&
    head.status === "queued" &&
    head.turnId == null &&
    head.adapterMsg.type === "codex_start_pending";
  if (head && !mutableQueuedBatch) {
    for (const id of head.pendingInputIds ?? [head.userMessageId]) coveredIds.add(id);
  }
  return pendingInputs.filter(
    (input) => input.cancelable && input.deliveryState !== "failed" && !coveredIds.has(input.id),
  );
}
