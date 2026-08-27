import type { CodexOutboundTurn } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import type { TurnSteerFailureInfo } from "./adapter-interface.js";

interface SteerFailureRecoverySession {
  id: string;
  isGenerating: boolean;
  pendingCodexTurns: CodexOutboundTurn[];
  codexAdapter: { getCurrentTurnId(): string | null } | null;
}

interface SteerFailureRecoveryDeps {
  getCodexHeadTurn(session: SteerFailureRecoverySession): CodexOutboundTurn | null;
  completeCodexTurn(session: SteerFailureRecoverySession, turn: CodexOutboundTurn | null): boolean;
  setGenerating(session: SteerFailureRecoverySession, generating: boolean, reason: string): void;
  persistSession(session: SteerFailureRecoverySession): void;
}

/**
 * A classified `no active turn` response is provider proof that the exact
 * current turn Takode tried to steer can no longer drain the queue. Retire
 * only that exact current owner, and never the still-pending steered input.
 */
export function retireProvenInactiveCodexTurnAfterSteerFailure(
  session: SteerFailureRecoverySession,
  pendingInputIds: string[],
  failure: TurnSteerFailureInfo | undefined,
  deps: SteerFailureRecoveryDeps,
): boolean {
  if (failure?.kind !== "no_active_turn") return false;
  if (session.codexAdapter?.getCurrentTurnId()) return false;

  const head = deps.getCodexHeadTurn(session);
  if (
    !head ||
    head.status !== "backend_acknowledged" ||
    head.turnTarget !== "current" ||
    head.turnId !== failure.expectedTurnId
  ) {
    return false;
  }

  const failedInputIds = new Set(pendingInputIds);
  const headInputIds = head.pendingInputIds ?? [head.userMessageId];
  if (headInputIds.some((id) => failedInputIds.has(id))) return false;

  deps.completeCodexTurn(session, head);
  if (session.isGenerating) {
    deps.setGenerating(session, false, "codex_steer_no_active_turn");
  }
  deps.persistSession(session);
  console.warn(
    `[ws-bridge] Retired provider-inactive Codex turn ${failure.expectedTurnId} for session ${sessionTag(session.id)}; retrying owner-scoped queued input`,
  );
  return true;
}
