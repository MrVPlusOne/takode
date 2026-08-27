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
  const head = deps.getHead();
  const adapter = session.codexAdapter;
  if (!head || head.status !== "backend_acknowledged" || session.isGenerating) return false;
  if (!adapter || session.state.backend_state !== "connected" || !adapter.isConnected()) return false;
  if (adapter.getCurrentTurnId()) return false;

  const activity = summarizeLocalCodexDeliveryActivity(session, head);
  if (activity.count > 0) {
    console.warn(
      `[ws-bridge] Settling non-drainable Codex turn ${head.turnId ?? "<untracked>"} without replay for session ${sessionTag(session.id)} (${reason}, activity=${activity.kinds.join(",")}, count=${activity.count})`,
    );
    deps.settleObservedActivity(head, activity);
    return true;
  }

  console.warn(
    `[ws-bridge] Retrying non-drainable Codex turn ${head.turnId ?? "<untracked>"} ` +
      `for session ${sessionTag(session.id)} (${reason})`,
  );
  deps.retry(head);
  return true;
}
