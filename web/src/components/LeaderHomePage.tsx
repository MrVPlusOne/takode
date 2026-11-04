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
import { useComposerOverlayLift } from "./ComposerFeedLayout.js";
import { NotificationChip } from "./NotificationChip.js";
import { threadNameFromMessage } from "./side-column/thread-names.js";
import { sideComposerDraftKey } from "../draft-sync-bridge.js";
import { useLeaderThreadMembers, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/**
 * A leader's Home, where its Main conversation was: its threads in one list (`HomeThreadList`), then links to the leader log and the topics, over a message box that starts
 * a new thread, which then opens here. Main's own messages are in the leader log; anything the user
 * should read lives in a thread.
 */
export function LeaderHomePage({ leaderId }: { leaderId: string }) {
  const threads = useLeaderThreadMembers((state) => state.byLeader[leaderId]) ?? EMPTY_THREADS;
  const composerOverlayLift = useComposerOverlayLift();
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Wider as the main view grows (by its own width: the side column takes room from it), so
            rows truncate no more than they must (Jiayi, Nov 1). The bottom room keeps the last row
            clear of the Next chip. */}
        <div className="@container min-h-0 flex-1 overflow-y-auto" data-testid="leader-home">
          <div className="mx-auto w-full max-w-3xl px-3 pb-14 pt-4 sm:px-6 @5xl:max-w-4xl @6xl:max-w-5xl">
            <LeaderHomeContent leaderId={leaderId} threads={threads} composerBelow />
          </div>
        </div>
        {/* The leader's Next chip, where a conversation has it (Jiayi, Nov 3: it was missing on Home). */}
        <div
          style={composerOverlayLift}
          className="pointer-events-none absolute bottom-2 right-2 z-10 flex sm:bottom-3 sm:right-3"
          data-testid="leader-home-next"
        >
          <NotificationChip sessionId={leaderId} />
        </div>
      </div>
      <NewThreadComposer leaderId={leaderId} />
    </>
  );
}

/**
 * A Home's threads (the status row's members), then links to the leader log and the topics. What
 * is clicked there opens in the main view, also from a Home in the side column.
 */
export function LeaderHomeContent({
  leaderId,
  threads,
  composerBelow = false,
}: {
  leaderId: string;
  threads: readonly PrimaryThreadChip[];
  /** A message box under it starts threads, which the empty Home points to. */
  composerBelow?: boolean;
}) {
  return (
    <>
      <HomeThreads leaderId={leaderId} threads={threads} composerBelow={composerBelow} />
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
function HomeThreads({
  leaderId,
  threads,
  composerBelow,
}: {
  leaderId: string;
  threads: readonly PrimaryThreadChip[];
  composerBelow: boolean;
}) {
  const writing = useStore((state) =>
    state.sessionStatus.get(leaderId) === "running" ? (state.activeTurnRoutes.get(leaderId)?.threadKey ?? null) : null,
  );
  const questIds = useMemo(() => threads.flatMap((tab) => (tab.questId ? [tab.questId] : [])), [threads]);
  const lineOf = useHomeLines(leaderId, questIds);
  const lastLooked = useLastLooked(leaderId);
  if (threads.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[13px] text-cc-muted" data-testid="leader-home-empty">
        {composerBelow ? "No threads yet. Write below to start one." : "No threads yet."}
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
