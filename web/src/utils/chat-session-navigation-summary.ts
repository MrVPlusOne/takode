import { resolveSessionNavigation, type SessionNavigationResolverSource } from "./session-navigation-resolver.js";

export function resolveChatSessionNavigationSummary(source: SessionNavigationResolverSource, sessionId: string) {
  const session = resolveSessionNavigation(source, sessionId)?.viewModel;
  return {
    isLeaderSession: session?.isOrchestrator === true,
    sessionNum: session?.sessionNum ?? null,
    claimedQuestId: session?.claimedQuestId ?? null,
    claimedQuestTitle: session?.claimedQuestTitle ?? null,
    claimedQuestStatus: session?.claimedQuestStatus ?? null,
    claimedQuestLeaderSessionId: session?.claimedQuestLeaderSessionId ?? null,
    herdedBy: session?.herdedBy ?? null,
  };
}
