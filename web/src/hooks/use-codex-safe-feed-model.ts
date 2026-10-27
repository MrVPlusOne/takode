import { useMemo } from "react";
import type { ChatMessage, SessionNotification } from "../types.js";
import { collectAnchoredNotificationMessageIds } from "../utils/anchored-notifications.js";
import { stripRootCodexThinkingMessages } from "../utils/assistant-content-blocks.js";
import { splitTurnsByPart, useFeedModel } from "./use-feed-model.js";

export function useCodexSafeFeedModel(params: {
  messages: ChatMessage[];
  frozenCount: number;
  frozenRevision: number;
  isCodexSession: boolean;
  leaderMode: boolean;
  leaderSessionMode: boolean;
  peerLeaderTurns: boolean;
  sessionNotifications: ReadonlyArray<SessionNotification> | undefined;
  userBoundarySourceSessionId: string | null;
  visibleAssistantChildMessageIds?: readonly string[];
  leadingTurnId?: string;
  /** In a topic conversation: the topic quest a message belongs to; each quest's work becomes its own turn. */
  turnPartOf?: ((message: ChatMessage) => string | null) | null;
  perf: { sessionId: string; threadKey: string };
}) {
  const anchoredNotificationMessageIds = useMemo(
    () => collectAnchoredNotificationMessageIds(params.sessionNotifications),
    [params.sessionNotifications],
  );
  const feedMessages = useMemo(
    () =>
      params.isCodexSession
        ? stripRootCodexThinkingMessages(params.messages, params.frozenCount)
        : { messages: params.messages, frozenCount: params.frozenCount },
    [params.frozenCount, params.isCodexSession, params.messages],
  );
  const model = useFeedModel(feedMessages.messages, {
    leaderMode: params.leaderMode,
    leaderSessionMode: params.leaderSessionMode,
    peerLeaderTurns: params.peerLeaderTurns,
    frozenCount: feedMessages.frozenCount,
    frozenRevision: params.frozenRevision,
    anchoredNotificationMessageIds,
    userBoundarySourceSessionId: params.userBoundarySourceSessionId,
    visibleAssistantChildMessageIds: params.visibleAssistantChildMessageIds,
    leadingTurnId: params.leadingTurnId,
    perf: params.perf,
  });
  const { turnPartOf, leaderMode, leaderSessionMode, visibleAssistantChildMessageIds } = params;
  return useMemo(
    () =>
      turnPartOf
        ? {
            ...model,
            turns: splitTurnsByPart(model.turns, turnPartOf, {
              leaderMode,
              leaderSessionMode,
              anchoredNotificationMessageIds,
              visibleAssistantChildMessageIds,
            }),
          }
        : model,
    [model, turnPartOf, leaderMode, leaderSessionMode, anchoredNotificationMessageIds, visibleAssistantChildMessageIds],
  );
}
