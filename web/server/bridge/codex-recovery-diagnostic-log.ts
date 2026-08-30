import type { CodexResumeTurnSnapshot } from "../codex-adapter.js";
import type { CodexOutboundTurn } from "../session-types.js";
import type { ThreadRouteMetadata } from "../thread-routing-metadata.js";
import { createLogger } from "../server-logger.js";
import type { CodexLocalDeliveryActivitySummary } from "./codex-delivery-ownership.js";

const recoveryLogger = createLogger("codex-recovery");

export type CodexRecoveryDiagnosticPresentation =
  | "continuation_queued"
  | "action_required"
  | "routed_fallback"
  | "browser_error";

export interface CodexRecoveryDiagnosticOutcome {
  continuationQueued: boolean;
  diagnosticAppended: boolean;
  browserErrorBroadcast: boolean;
}

export interface CodexRecoveryDiagnosticLogContext {
  sessionId: string;
  reason: string;
  ownerId: string;
  ownerStatus: string;
  providerTurnId: string | null;
  threadStatus: string | null;
  turnStatus: string | null;
  evidenceClass: "interrupted_assistant" | "assistant_tool_tail" | "tool_tail" | "interrupted_activity";
  recoveredAssistantCount: number;
  synthesizedToolResultCount: number;
  omittedToolResultCount: number;
  activityKinds: CodexLocalDeliveryActivitySummary["kinds"];
  activityCount: number;
  sameTurnCoOwnerCount: number;
  routeThreadKey: string | null;
  routeQuestId: string | null;
}

export interface CodexRecoveryDiagnosticLogEntry
  extends CodexRecoveryDiagnosticLogContext,
    CodexRecoveryDiagnosticOutcome {
  presentation: CodexRecoveryDiagnosticPresentation;
}

export function buildCodexRecoveryDiagnosticLogContext(input: {
  session: { id: string; pendingCodexTurns: CodexOutboundTurn[] };
  owner: CodexOutboundTurn;
  lastTurn: CodexResumeTurnSnapshot;
  threadStatus: string | null | undefined;
  reason: string;
  evidenceClass: CodexRecoveryDiagnosticLogContext["evidenceClass"];
  recoveredAssistantCount: number;
  synthesizedToolResultCount: number;
  omittedToolResultCount: number;
  activity: CodexLocalDeliveryActivitySummary;
  route: ThreadRouteMetadata | null;
}): CodexRecoveryDiagnosticLogContext {
  const providerTurnId = input.owner.turnId ?? input.lastTurn.id ?? null;
  const sameTurnOwnerIds = new Set([input.owner.userMessageId]);
  if (providerTurnId) {
    for (const turn of input.session.pendingCodexTurns) {
      if (turn.userMessageId === input.owner.userMessageId || turn.turnId === providerTurnId) {
        sameTurnOwnerIds.add(turn.userMessageId);
      }
    }
  }
  return {
    sessionId: input.session.id,
    reason: input.reason,
    ownerId: input.owner.userMessageId,
    ownerStatus: input.owner.status,
    providerTurnId,
    threadStatus: input.threadStatus ?? null,
    turnStatus: input.lastTurn.status ?? null,
    evidenceClass: input.evidenceClass,
    recoveredAssistantCount: input.recoveredAssistantCount,
    synthesizedToolResultCount: input.synthesizedToolResultCount,
    omittedToolResultCount: input.omittedToolResultCount,
    activityKinds: input.activity.kinds,
    activityCount: input.activity.count,
    sameTurnCoOwnerCount: sameTurnOwnerIds.size,
    routeThreadKey: input.route?.threadKey ?? null,
    routeQuestId: input.route?.questId ?? null,
  };
}

export function logCodexRecoveryDiagnostic(entry: CodexRecoveryDiagnosticLogEntry): void {
  recoveryLogger.warn("Codex resumed turn settled without automatic replay", {
    sessionId: entry.sessionId,
    source: "resume_reconciliation",
    reason: entry.reason,
    ownerId: entry.ownerId,
    ownerStatus: entry.ownerStatus,
    providerTurnId: entry.providerTurnId,
    threadStatus: entry.threadStatus,
    turnStatus: entry.turnStatus,
    evidenceClass: entry.evidenceClass,
    recoveredAssistantCount: entry.recoveredAssistantCount,
    synthesizedToolResultCount: entry.synthesizedToolResultCount,
    omittedToolResultCount: entry.omittedToolResultCount,
    activityKinds: entry.activityKinds,
    activityCount: entry.activityCount,
    sameTurnCoOwnerCount: entry.sameTurnCoOwnerCount,
    presentation: entry.presentation,
    continuationQueued: entry.continuationQueued,
    diagnosticAppended: entry.diagnosticAppended,
    browserErrorBroadcast: entry.browserErrorBroadcast,
    routeThreadKey: entry.routeThreadKey,
    routeQuestId: entry.routeQuestId,
  });
}
