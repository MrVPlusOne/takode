import { api } from "./api.js";
import { useStore } from "./store.js";
import type { BrowserIncomingMessage, ChatMessage } from "./types.js";
import { questOwnsSessionName } from "./utils/quest-helpers.js";

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
  for (const session of [...store.sessions.values(), ...store.sdkSessions]) {
    if (session.isOrchestrator !== true) continue;
    for (const threadKey of session.leaderOpenThreadTabs?.orderedOpenThreadKeys ?? []) {
      const questId = threadKey.trim().toLowerCase();
      if (/^q-\d+$/.test(questId)) openQuestIds.add(questId);
    }
  }
  if (openQuestIds.size > 0) void store.hydrateQuestTitles([...openQuestIds], { force: true });
}

export function handleSessionQuestClaimed(sessionId: string, data: SessionQuestClaimedMessage): void {
  const store = useStore.getState();
  console.log(`[ws] session_quest_claimed for ${sessionId}:`, data.quest);
  const prevStatus = store.sessions.get(sessionId)?.claimedQuestStatus;
  const prevQuestId = store.sessions.get(sessionId)?.claimedQuestId;
  const prevTitle = store.sessions.get(sessionId)?.claimedQuestTitle;
  store.updateSession(sessionId, {
    claimedQuestId: data.quest?.id ?? undefined,
    claimedQuestTitle: data.quest?.title ?? undefined,
    claimedQuestStatus: data.quest?.status ?? undefined,
    claimedQuestVerificationInboxUnread: data.quest?.verificationInboxUnread,
    claimedQuestLeaderSessionId: data.quest?.leaderSessionId,
  });
  const currentSdkSession = store.sdkSessions.find((sdk) => sdk.sessionId === sessionId);
  const useQuestTitle = !!(
    data.quest?.id &&
    data.quest.title &&
    questOwnsSessionName(data.quest.status, data.quest.verificationInboxUnread) &&
    currentSdkSession?.isOrchestrator !== true &&
    store.sessions.get(sessionId)?.isOrchestrator !== true
  );
  store.updateSdkSession(sessionId, {
    claimedQuestId: data.quest?.id ?? null,
    claimedQuestTitle: data.quest?.title ?? null,
    claimedQuestStatus: data.quest?.status ?? null,
    claimedQuestVerificationInboxUnread: data.quest?.verificationInboxUnread,
    claimedQuestLeaderSessionId: data.quest?.leaderSessionId ?? null,
    ...(useQuestTitle ? { name: data.quest!.title } : {}),
  });
  if (useQuestTitle && currentSdkSession?.name !== data.quest!.title) store.markRecentlyRenamed(sessionId);

  if (!data.quest?.id) return;
  const questId = data.quest.id;
  const isStatusChange = prevQuestId === questId && !!prevStatus && prevStatus !== data.quest.status;
  const isTitleOnly = prevQuestId === questId && !isStatusChange && prevTitle !== data.quest.title;
  if (isTitleOnly) {
    store.updateQuestTitleInMessages(sessionId, questId, data.quest.title);
    return;
  }
  const isSubmitted =
    isStatusChange &&
    (data.quest.status === "needs_verification" ||
      (data.quest.status === "done" && data.quest.verificationInboxUnread !== undefined));
  const variant = isSubmitted ? ("quest_submitted" as const) : ("quest_claimed" as const);
  const label = isSubmitted ? "Quest submitted" : "Quest claimed";
  if (isStatusChange && !isSubmitted) return;

  api
    .getQuest(questId)
    .then((quest) => {
      const questMeta: ChatMessage["metadata"] = {
        quest: {
          questId: quest.questId,
          title: quest.title,
          description: "description" in quest ? quest.description : undefined,
          tldr: quest.tldr,
          status: quest.status,
          tags: quest.tags,
          images: quest.images,
          verificationItems: "verificationItems" in quest ? quest.verificationItems : undefined,
          leaderSessionId: quest.leaderSessionId,
        },
      };
      useStore.getState().appendMessage(sessionId, {
        id: `${variant}-${questId}-${Date.now()}`,
        role: "system",
        content: `${label}: ${quest.title}`,
        timestamp: Date.now(),
        variant,
        metadata: questMeta,
        ephemeral: true,
      });
    })
    .catch(() => {
      useStore.getState().appendMessage(sessionId, {
        id: `${variant}-${questId}-${Date.now()}`,
        role: "system",
        content: `${label}: ${data.quest!.title}`,
        timestamp: Date.now(),
        variant,
        ephemeral: true,
        metadata: {
          quest: {
            questId,
            title: data.quest!.title,
            status: data.quest!.status ?? (isSubmitted ? "done" : "in_progress"),
            leaderSessionId: data.quest!.leaderSessionId,
          },
        },
      });
    });
}
