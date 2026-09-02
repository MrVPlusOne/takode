import { AsyncLocalStorage } from "node:async_hooks";
import type { BrowserOutgoingMessage, SessionState } from "../session-types.js";

export interface TrustedCodexRecoveryRoute {
  queueBeforeOwnerId?: string;
  requireFreshSuccessor: true;
}

interface TrustedCodexRecoveryRouteContext extends TrustedCodexRecoveryRoute {
  sessionId: string;
  recoveryId: string;
  sourceId: string;
  visibleContent: string;
  deliveryContent: string;
  threadKey: string;
  questId?: string;
}

const trustedCodexRecoveryRoute = new AsyncLocalStorage<TrustedCodexRecoveryRouteContext>();

export function withTrustedCodexRecoveryRoute<T>(
  session: { id: string },
  context: Omit<TrustedCodexRecoveryRouteContext, "sessionId" | "requireFreshSuccessor">,
  task: () => T,
): T {
  return trustedCodexRecoveryRoute.run(
    {
      ...context,
      sessionId: session.id,
      requireFreshSuccessor: true,
    },
    task,
  );
}

export function getTrustedCodexRecoveryRoute(
  session: { id: string; state: Pick<SessionState, "codex_turn_recovery"> },
  message: BrowserOutgoingMessage,
): TrustedCodexRecoveryRoute | null {
  const context = trustedCodexRecoveryRoute.getStore();
  if (!context || context.sessionId !== session.id || message.type !== "user_message") return null;
  if (session.state.codex_turn_recovery?.recoveryId !== context.recoveryId) return null;
  if (message.agentSource?.sessionId !== context.sourceId) return null;
  if (message.content !== context.visibleContent || message.deliveryContent !== context.deliveryContent) return null;
  if ((message.threadKey ?? "main") !== context.threadKey || message.questId !== context.questId) return null;
  return {
    ...(context.queueBeforeOwnerId ? { queueBeforeOwnerId: context.queueBeforeOwnerId } : {}),
    requireFreshSuccessor: true,
  };
}
