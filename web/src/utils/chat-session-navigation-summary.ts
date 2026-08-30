import { resolveSessionNavigation, type SessionNavigationResolverSource } from "./session-navigation-resolver.js";

export function resolveChatSessionNavigationSummary(source: SessionNavigationResolverSource, sessionId: string) {
  const sessionState = source.sessions.get(sessionId);
  const sdkSession = source.sdkSessions.find((sdk) => sdk.sessionId === sessionId);
  const navigation = resolveSessionNavigation(source, sessionId);
  if (navigation && navigation.projectionState !== "legacy") {
    const viewModel = navigation.viewModel;
    return {
      isLeaderSession: viewModel.isOrchestrator === true,
      sessionNum: viewModel.sessionNum ?? null,
      claimedQuestId: viewModel.claimedQuestId ?? null,
      claimedQuestTitle: viewModel.claimedQuestTitle ?? null,
      claimedQuestStatus: viewModel.claimedQuestStatus ?? null,
      claimedQuestLeaderSessionId: viewModel.claimedQuestLeaderSessionId ?? null,
      herdedBy: viewModel.herdedBy ?? null,
    };
  }
  return {
    isLeaderSession: sessionState?.isOrchestrator === true || sdkSession?.isOrchestrator === true,
    sessionNum: sdkSession?.sessionNum ?? null,
    claimedQuestId: sessionState?.claimedQuestId ?? sdkSession?.claimedQuestId ?? null,
    claimedQuestTitle: sessionState?.claimedQuestTitle ?? sdkSession?.claimedQuestTitle ?? null,
    claimedQuestStatus: sessionState?.claimedQuestStatus ?? sdkSession?.claimedQuestStatus ?? null,
    claimedQuestLeaderSessionId:
      sessionState?.claimedQuestLeaderSessionId ?? sdkSession?.claimedQuestLeaderSessionId ?? null,
    herdedBy: sdkSession?.herdedBy ?? null,
  };
}
