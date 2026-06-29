import { useCallback } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { isMessageStarred, isStarActionableMessage } from "../utils/starred-messages.js";

export function useMessageStarActions(sessionId: string | undefined, message: ChatMessage) {
  const session = useStore((s) => (sessionId ? s.sessions.get(sessionId) : undefined));
  const starred = isMessageStarred(session, message.id);
  const actionable = Boolean(sessionId) && isStarActionableMessage(message);
  const toggleStarred = useCallback(() => {
    if (!sessionId || !actionable) return;
    const request = starred
      ? api.unstarMessage(sessionId, message.id)
      : api.starMessage(sessionId, message.id, { historyIndex: message.historyIndex });
    request.catch((err) => {
      console.error("Failed to update starred message:", err);
    });
  }, [actionable, message.historyIndex, message.id, sessionId, starred]);

  return {
    actionable,
    starred,
    label: starred ? "Unstar message" : "Star message",
    toggleStarred,
  };
}
