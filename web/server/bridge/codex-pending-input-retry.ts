import type { ActiveTurnRoute, PendingCodexInput } from "../session-types.js";
import { compactPendingCodexInputsForBrowser } from "../codex-pending-input-safety.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";

type RetryDeps = Pick<
  AdapterBrowserRoutingDeps,
  | "broadcastToBrowsers"
  | "isCodexWorkerV2DeliveryFrozen"
  | "markRunningFromUserDispatch"
  | "persistSession"
  | "queueCodexPendingStartBatch"
  | "rebuildQueuedCodexPendingStartBatch"
  | "requestCodexAutoRecovery"
  | "trySteerPendingCodexInputs"
>;

export function retryFailedCodexPendingInput(
  session: AdapterBrowserRoutingSessionLike,
  id: string,
  deps: RetryDeps,
): PendingCodexInput | null {
  const input = session.pendingCodexInputs.find((candidate) => candidate.id === id);
  if (!input || input.deliveryState !== "failed") return null;

  delete input.deliveryState;
  delete input.failureReason;
  delete input.failureMessage;
  delete input.failedAt;
  input.cancelable = true;
  input.autoPauseSourceKind = "manual";
  deps.broadcastToBrowsers(session, {
    type: "codex_pending_inputs",
    inputs: compactPendingCodexInputsForBrowser(session.pendingCodexInputs),
  });

  const deliveryFrozen = deps.isCodexWorkerV2DeliveryFrozen(session.id);
  const activeTurnRoute: ActiveTurnRoute | null = input.threadKey
    ? { threadKey: input.threadKey, ...(input.questId ? { questId: input.questId } : {}) }
    : null;
  let turnTarget = null;
  if (
    !deliveryFrozen &&
    session.state.backend_state !== "broken" &&
    session.state.backend_state !== "recovery_suppressed"
  ) {
    turnTarget = deps.markRunningFromUserDispatch(
      session,
      "retry_pending_codex_input",
      "user",
      undefined,
      activeTurnRoute,
    );
  }

  const currentTurnId = session.codexAdapter?.getCurrentTurnId() ?? null;
  if (deliveryFrozen) {
    deps.rebuildQueuedCodexPendingStartBatch(session);
  } else if (currentTurnId) {
    if (!deps.trySteerPendingCodexInputs(session, "retry_pending_codex_input")) {
      deps.rebuildQueuedCodexPendingStartBatch(session);
    }
  } else if (session.codexAdapter && turnTarget === "queued" && session.isGenerating) {
    deps.rebuildQueuedCodexPendingStartBatch(session);
  } else {
    deps.queueCodexPendingStartBatch(session, "retry_pending_codex_input");
  }

  if (!session.codexAdapter || !session.codexAdapter.isConnected()) {
    deps.requestCodexAutoRecovery(session, "retry_failed_pending_input");
  }
  deps.persistSession(session);
  return input;
}
