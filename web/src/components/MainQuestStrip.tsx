import { createContext, useContext, useEffect } from "react";
import type { StartedQuest } from "../api/started-quests.js";
import type { ChatMessage } from "../types.js";
import { isUserBoundaryEntry, type Turn } from "../hooks/use-feed-model.js";
import { loadLeaderTopics, useKnownQuestTopic } from "../utils/leader-topics.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { TopicIcon } from "./library/library-icons.js";
import { continuedQuestOf, StartedQuestsContext } from "./QuestForkLinks.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import { STRIP_WRAPPER } from "./topic-feed.js";

/**
 * A leader's Main names the quest each request went to with the topic conversation's design
 * (Jiayi's pick, Oct 29): an inline strip "📖 Topic › q-N title · status" above a request that moved
 * into a quest, sticking to the top while that part of Main is read; a "Main" strip where Main's own
 * conversation resumes, so the pinned strip never names a quest the conversation left. The request
 * itself then carries no topic label or "Continued in" row for that quest.
 */

/** Whether the feed draws Main's quest strips: then the strips, not the requests, name their quests. */
export const MainQuestStripsContext = createContext(false);

/**
 * The quest a user message continues in: one it was moved into (handed off), or one filed from it
 * that is not a side quest; never the quest on screen.
 */
export function useContinuedQuest(
  message: Pick<ChatMessage, "id" | "metadata">,
  currentThreadKey?: string,
): StartedQuest | null {
  const started = useContext(StartedQuestsContext)?.get(message.id) ?? null;
  const current = currentThreadKey ? normalizeThreadKey(currentThreadKey) : null;
  const quest = continuedQuestOf(message, started);
  return quest && normalizeThreadKey(quest.questId) !== current ? quest : null;
}

/** Which turns of Main get a strip, and for which quest (null: "Main"). */
export function mainQuestStrips(
  turns: ReadonlyArray<Pick<Turn, "userEntry">>,
  started: ReadonlyMap<string, StartedQuest[]> | null,
): Array<{ quest: StartedQuest | null } | null> {
  let pinned: string | null = null;
  return turns.map((turn) => {
    // Only the user's own requests move the conversation; worker events, timers, injected notices
    // and other agents' messages don't.
    if (!isUserBoundaryEntry(turn.userEntry) || turn.userEntry?.kind !== "message") return null;
    const message = turn.userEntry.msg;
    const quest = continuedQuestOf(message, started?.get(message.id) ?? null);
    const key = quest?.questId ?? null;
    if (key === pinned) return null;
    pinned = key;
    return { quest };
  });
}

/** The strip: the quest a request went to, with its topic, or "Main" where Main's conversation resumes. */
export function MainQuestStrip({ sessionId, quest }: { sessionId: string; quest: StartedQuest | null }) {
  const topic = useTopicOfQuest(sessionId, quest?.questId ?? "");
  const record = useQuestRecord(quest?.questId ?? null);
  const status = record ? (record.status === "done" ? "Done" : record.status.replace("_", " ")) : "";
  return (
    <div
      className={STRIP_WRAPPER}
      data-testid="main-quest-strip"
      data-feed-quest-strip="true"
      data-quest={quest?.questId ?? "main"}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-cc-border bg-cc-card/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm sm:text-[13px]">
        {!quest ? (
          <span className="font-medium text-cc-fg">Main</span>
        ) : (
          <>
            {topic && (
              <>
                <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
                <span className="min-w-0 max-w-[35%] shrink truncate text-cc-muted">{topic.name}</span>
                <span aria-hidden="true" className="shrink-0 text-cc-muted">
                  ›
                </span>
              </>
            )}
            {/* The quest ID is a real quest link; the rest of the strip continues in the quest. */}
            <span className="shrink-0 font-mono-code">
              <QuestInlineLink questId={quest.questId} surface="chat-feed" />
            </span>
            <button
              type="button"
              onClick={() =>
                navigateToSessionMessageId(quest.startedFrom.sessionId, quest.startedFrom.messageId, {
                  threadKey: normalizeThreadKey(quest.questId),
                })
              }
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
              title="Continue in this quest's thread, at this request"
            >
              <span className="min-w-0 truncate font-medium text-cc-fg">{quest.title}</span>
              {status && <span className="shrink-0 text-cc-muted">· {status}</span>}
              <span aria-hidden="true" className="ml-auto shrink-0 pl-1 text-cc-muted">
                ›
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function useTopicOfQuest(sessionId: string, questId: string) {
  const topic = useKnownQuestTopic(sessionId, questId);
  useEffect(() => {
    if (!questId || topic !== undefined) return;
    loadLeaderTopics(sessionId, [questId]).catch((error: Error) =>
      console.warn("[library] Could not look up a quest's topic:", error.message),
    );
  }, [sessionId, questId, topic]);
  return topic ?? null;
}
