import { useStore } from "./store.js";
import type { BrowserIncomingMessage } from "./types.js";
import { resolveLeaderThreadTabsProjection } from "./utils/leader-thread-tabs-resolver.js";

type QuestListUpdatedMessage = Extract<BrowserIncomingMessage, { type: "quest_list_updated" }>;
type SessionQuestClaimedMessage = Extract<BrowserIncomingMessage, { type: "session_quest_claimed" }>;

export function handleQuestListUpdated(data: QuestListUpdatedMessage): void {
  const store = useStore.getState();
  if (data.quest) store.upsertQuestTitlePreview(data.quest);
  store.invalidateQuestAutocompleteCandidates();
  void store.refreshQuestAutocompleteCandidates({ force: true, background: true });
  void store.refreshQuestSummary({ force: true });

  // Retained leader tabs intentionally outlive board/default quest-list rows.
  // Refresh only their minimal exact projections, keeping the live update
  // visible until the bounded server response confirms it.
  const openQuestIds = new Set<string>();
  const leaderSessionIds = new Set(
    store.sdkSessions.filter((session) => session.isOrchestrator === true).map((session) => session.sessionId),
  );
  for (const [sessionId, session] of store.sessions) {
    if (session.isOrchestrator === true) leaderSessionIds.add(sessionId);
  }
  for (const sessionId of leaderSessionIds) {
    const resolution = resolveLeaderThreadTabsProjection(store, sessionId);
    if (resolution.projectionState !== "accepted") continue;
    for (const tab of resolution.value.tabs) {
      const questId = (tab.questId ?? tab.threadKey).trim().toLowerCase();
      if (/^q-\d+$/.test(questId)) openQuestIds.add(questId);
    }
  }
  if (openQuestIds.size > 0) void store.hydrateQuestTitles([...openQuestIds], { force: true });
}

export function handleSessionQuestClaimed(sessionId: string, data: SessionQuestClaimedMessage): void {
  console.log(`[ws] session_quest_claimed for ${sessionId}:`, data.quest);
  useStore.getState().updateSession(sessionId, {
    claimedQuestId: data.quest?.id ?? undefined,
    claimedQuestTitle: data.quest?.title ?? undefined,
    claimedQuestStatus: data.quest?.status ?? undefined,
    claimedQuestVerificationInboxUnread: data.quest?.verificationInboxUnread,
    claimedQuestLeaderSessionId: data.quest?.leaderSessionId,
  });
}
