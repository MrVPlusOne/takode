import { useCallback, useMemo } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";

function selectedQuestId(threadKey: string | undefined): string | null {
  const normalized = threadKey?.trim().toLowerCase() ?? "";
  return /^q-\d+$/.test(normalized) ? normalized : null;
}

export function useQuestOutcomeMessageActions(input: {
  message: ChatMessage;
  sessionId?: string;
  currentThreadKey?: string;
  onFeedback: (label: string) => void;
}) {
  const directQuestId = useMemo(() => selectedQuestId(input.currentThreadKey), [input.currentThreadKey]);
  const isLeader = useStore((state) =>
    input.sessionId
      ? state.sessions.get(input.sessionId)?.isOrchestrator === true ||
        state.sdkSessions.some((session) => session.sessionId === input.sessionId && session.isOrchestrator === true)
      : false,
  );
  const activeBoard = useStore((state) => (input.sessionId ? state.sessionBoards?.get(input.sessionId) : undefined));
  const completedBoard = useStore((state) =>
    input.sessionId ? state.sessionCompletedBoards?.get(input.sessionId) : undefined,
  );
  const mainTargets = useMemo(() => {
    const normalizedThreadKey = input.currentThreadKey?.trim().toLowerCase() ?? "main";
    if (!isLeader || normalizedThreadKey !== "main") return [];
    const targets = new Map<string, string>();
    for (const row of [...(activeBoard ?? []), ...(completedBoard ?? [])]) {
      const questId = row.questId?.trim().toLowerCase();
      if (/^q-\d+$/.test(questId)) targets.set(questId, row.title?.trim() || questId);
    }
    return [...targets].map(([questId, title]) => ({ questId, title }));
  }, [activeBoard, completedBoard, input.currentThreadKey, isLeader]);
  const messageEligible = Boolean(
    isLeader &&
      input.sessionId &&
      input.message.role === "assistant" &&
      input.message.content.trim() &&
      !input.message.metadata?.codexSubagent,
  );
  const available = Boolean(messageEligible && directQuestId);

  const updateFromMessage = useCallback(
    async (questId: string, mode: "replace" | "append") => {
      if (!messageEligible || !input.sessionId) return;
      try {
        const current = await api.getQuestOutcome(questId);
        const baseRevisionId = current.outcome?.currentRevisionId ?? null;
        const result = await api.updateQuestOutcome(questId, {
          baseRevisionId,
          mode,
          source: {
            sessionId: input.sessionId,
            messageId: input.message.id,
            ...(typeof input.message.historyIndex === "number" ? { historyIndex: input.message.historyIndex } : {}),
          },
          idempotencyKey: `${mode}:${questId}:${input.sessionId}:${input.message.id}:${baseRevisionId ?? "empty"}`,
        });
        useStore.getState().upsertQuestDetail(result.quest);
        input.onFeedback(mode === "append" ? "Added to Outcome" : "Outcome updated");
      } catch (error) {
        console.error("Quest Outcome update failed:", error);
        input.onFeedback("Outcome failed");
      }
    },
    [input, messageEligible],
  );

  return {
    available,
    mainTargets: messageEligible ? mainTargets : [],
    useAsOutcome: () => (directQuestId ? updateFromMessage(directQuestId, "replace") : undefined),
    addToOutcome: () => (directQuestId ? updateFromMessage(directQuestId, "append") : undefined),
    useForQuest: (questId: string) => updateFromMessage(questId, "replace"),
    addForQuest: (questId: string) => updateFromMessage(questId, "append"),
  };
}
