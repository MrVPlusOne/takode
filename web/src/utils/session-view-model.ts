import type { SdkSessionInfo } from "../types.js";

export type SessionViewModel = Omit<
  SdkSessionInfo,
  | "claimedQuestId"
  | "claimedQuestLeaderSessionId"
  | "claimedQuestStatus"
  | "claimedQuestTitle"
  | "contextTokensUsed"
  | "modelContextWindow"
> & {
  claimedQuestId?: string;
  claimedQuestLeaderSessionId?: string;
  claimedQuestStatus?: string;
  claimedQuestTitle?: string;
  contextTokensUsed?: number;
  modelContextWindow?: number;
  /** Provider-reported window before Takode effective-window selection. */
  backendReportedContextWindow?: number;
};

/** Add the few display aliases that are not already canonical session-row fields. */
export function toSessionViewModel(session: SdkSessionInfo): SessionViewModel {
  return {
    ...session,
    numTurns: session.userTurnCount ?? session.numTurns,
    claimedQuestId: session.claimedQuestId ?? undefined,
    claimedQuestLeaderSessionId: session.claimedQuestLeaderSessionId ?? undefined,
    claimedQuestStatus: session.claimedQuestStatus ?? undefined,
    claimedQuestTitle: session.claimedQuestTitle ?? undefined,
    contextTokensUsed: session.contextTokensUsed ?? undefined,
    modelContextWindow: session.modelContextWindow ?? undefined,
    backendReportedContextWindow: session.modelContextWindow ?? undefined,
    pausedInputQueueCount: session.pausedInputQueueCount ?? session.pause?.queuedMessages.length ?? 0,
  };
}
