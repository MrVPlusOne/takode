import { useMemo } from "react";
import { topicApi } from "../api/topics.js";
import { useStore } from "../store.js";
import { rememberThreads } from "../utils/leader-topics.js";
import { navigateToSessionThread } from "../utils/routing.js";
import { openInSide, openTopicsInSide } from "../utils/side-column.js";
import { ALL_THREADS_KEY } from "../utils/thread-projection.js";
import { Composer } from "./Composer.js";
import { threadNameFromMessage } from "./side-column/thread-names.js";
import { sideComposerDraftKey } from "../draft-sync-bridge.js";
import { ThreadGroupSections } from "./ThreadTabGroups.js";
import { useLeaderThreadMembers, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/**
 * A leader's Home, where its Main conversation was: its threads by what they need (the status row's
 * groups at full width), then links to the leader log and the topics, over a message box that starts
 * a new thread, which then opens here. Main's own messages are in the leader log; anything the user
 * should read lives in a thread.
 */
export function LeaderHomePage({ leaderId }: { leaderId: string }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="leader-home">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6">
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
              onClick={() => openTopicsInSide(leaderId)}
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
 * leader (named after its first words until the leader names it), which then opens in the main view.
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

/** The leader's threads by what they need, as its status row lists them. */
function HomeThreads({ leaderId }: { leaderId: string }) {
  const threads = useLeaderThreadMembers((state) => state.byLeader[leaderId]) ?? EMPTY_THREADS;
  const writing = useStore((state) =>
    state.sessionStatus.get(leaderId) === "running" ? (state.activeTurnRoutes.get(leaderId)?.threadKey ?? null) : null,
  );
  const open = (threadKey: string) => navigateToSessionThread(leaderId, threadKey);
  if (threads.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[13px] text-cc-muted" data-testid="leader-home-empty">
        No threads yet. Write below to start one.
      </p>
    );
  }
  return (
    <section
      className="overflow-hidden rounded-xl border border-cc-border bg-cc-card pb-1"
      data-testid="leader-home-threads"
    >
      <ThreadGroupSections
        threads={threads}
        context={{
          currentThreadKey: "main",
          activeOutputThreadKey: writing,
          onSelect: open,
          onOpenInSide: (threadKey) => openInSide(leaderId, { kind: "conversation", threadKey }),
        }}
        doneLimit={5}
      />
    </section>
  );
}

const EMPTY_THREADS: readonly PrimaryThreadChip[] = [];
