import type { CodexOutboundTurn } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import {
  summarizeLocalCodexDeliveryActivity,
  type CodexLocalDeliveryActivitySummary,
  type CodexDeliveryHistoryLike,
} from "./codex-delivery-ownership.js";

interface NonDrainableSession extends CodexDeliveryHistoryLike {
  id: string;
  isGenerating: boolean;
  state: { backend_state?: string };
  codexAdapter: { getCurrentTurnId(): string | null; isConnected(): boolean } | null;
}

export function recoverNonDrainableCodexHeadTurn(
  session: NonDrainableSession,
  reason: string,
  deps: {
    getHead(): CodexOutboundTurn | null;
    settleObservedActivity(head: CodexOutboundTurn, activity: CodexLocalDeliveryActivitySummary): void;
    retry(head: CodexOutboundTurn): void;
  },
): boolean {
  const adapter = session.codexAdapter;
  if (!adapter || session.state.backend_state !== "connected" || !adapter.isConnected()) return false;
  if (adapter.getCurrentTurnId()) return false;
  const settledOwners = new Set<string>();
  let handled = false;

  while (!session.isGenerating) {
    const head = deps.getHead();
    if (!head || head.status !== "backend_acknowledged") return handled;

    const activity = summarizeLocalCodexDeliveryActivity(session, head);
    if (activity.count === 0) {
      console.warn(
        `[ws-bridge] Retrying non-drainable Codex turn ${head.turnId ?? "<untracked>"} ` +
          `for session ${sessionTag(session.id)} (${reason})`,
      );
      deps.retry(head);
      return true;
    }

    if (settledOwners.has(head.userMessageId)) {
      console.warn(
        `[ws-bridge] Stopped non-drainable Codex settlement for session ${sessionTag(session.id)} ` +
          `because owner ${head.userMessageId} did not advance (${reason})`,
      );
      return handled;
    }
    settledOwners.add(head.userMessageId);
    console.warn(
      `[ws-bridge] Settling non-drainable Codex turn ${head.turnId ?? "<untracked>"} without replay for session ${sessionTag(session.id)} (${reason}, activity=${activity.kinds.join(",")}, count=${activity.count})`,
    );
    deps.settleObservedActivity(head, activity);
    handled = true;
  }

  return handled;
}
