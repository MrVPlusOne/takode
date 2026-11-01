import { useMemo } from "react";
import { SinceLastLooked, useHomeLines, useLastLooked } from "./home/HomeExtras.js";
import { HomeThreadList } from "./home/HomeThreadList.js";
import { topicApi } from "../api/topics.js";
import { useStore } from "../store.js";
import { rememberThreads } from "../utils/leader-topics.js";
import { navigateToSessionThread } from "../utils/routing.js";
import { openTopicsInSide } from "../utils/side-column.js";
import { ALL_THREADS_KEY } from "../utils/thread-projection.js";
import { Composer } from "./Composer.js";
import { threadNameFromMessage } from "./side-column/thread-names.js";
import { sideComposerDraftKey } from "../draft-sync-bridge.js";
import { useLeaderThreadMembers, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/**
 * A leader's Home, where its Main conversation was: its threads in one list (`HomeThreadList`), then links to the leader log and the topics, over a message box that starts
 * a new thread, which then opens here. Main's own messages are in the leader log; anything the user
 * should read lives in a thread.
 */
export function LeaderHomePage({ leaderId }: { leaderId: string }) {
  return (
    <>
      {/* Wider as the main view grows (by its own width: the side column takes room from it), so
          rows truncate no more than they must (Jiayi, Nov 1). */}
      <div className="@container min-h-0 flex-1 overflow-y-auto" data-testid="leader-home">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 @5xl:max-w-4xl @6xl:max-w-5xl">
          <HomeThreads leaderId={leaderId} />
          <div className="mt-3 flex gap-4 px-1 text-[12.5px] text-cc-muted">
            <button
              type="button"
              className="hover:text-cc-fg"
              onClick={() => navigateToSessionThread(leaderId, ALL_THREADS_KEY)}
              data-testid="leader-home-log"
            >
              Leader log
            </button>
            <button
              type="button"
              className="hover:text-cc-fg"
              onClick={() => openTopicsInSide()}
              data-testid="leader-home-topics"
            >
              Browse topics
            </button>
          </div>
        </div>
      </div>
      <NewThreadComposer leaderId={leaderId} />
    </>
  );
}

/**
 * The message box of a leader's Home and leader log: what you write starts a new thread with the
 * leader (named after its first words until its Scribe names it), which then opens in the main view.
 */
export function NewThreadComposer({ leaderId }: { leaderId: string }) {
  const newThread = useMemo(
    () => ({
      start: async (text: string) => {
        const { thread } = await topicApi.startThread(
          leaderId,
          threadNameFromMessage(text),
          undefined,
          text.slice(0, 400),
        );
        rememberThreads(leaderId, [thread], false);
        return thread.key;
      },
      started: (threadKey: string) => navigateToSessionThread(leaderId, threadKey),
    }),
    [leaderId],
  );
  return (
    <Composer
      sessionId={leaderId}
      threadKey="main"
      draftKey={sideComposerDraftKey(leaderId, "home")}
      newThread={newThread}
    />
  );
}

/**
 * The leader's threads (the status row's members) in one list, each with a line of news
 * (`useHomeLines`), under a line about what changed since the user last looked.
 */
function HomeThreads({ leaderId }: { leaderId: string }) {
  const threads = useLeaderThreadMembers((state) => state.byLeader[leaderId]) ?? EMPTY_THREADS;
  const writing = useStore((state) =>
    state.sessionStatus.get(leaderId) === "running" ? (state.activeTurnRoutes.get(leaderId)?.threadKey ?? null) : null,
  );
  const questIds = useMemo(() => threads.flatMap((tab) => (tab.questId ? [tab.questId] : [])), [threads]);
  const lineOf = useHomeLines(leaderId, questIds);
  const lastLooked = useLastLooked(leaderId);
  if (threads.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[13px] text-cc-muted" data-testid="leader-home-empty">
        No threads yet. Write below to start one.
      </p>
    );
  }
  return (
    <>
      <SinceLastLooked threads={threads} since={lastLooked} />
      <HomeThreadList leaderId={leaderId} threads={threads} lineOf={lineOf} writingThreadKey={writing} />
    </>
  );
}

const EMPTY_THREADS: readonly PrimaryThreadChip[] = [];
