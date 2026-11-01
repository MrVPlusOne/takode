import { useMemo } from "react";
import { useStore } from "../../store.js";
import { topicApi } from "../../api/topics.js";
import { rememberThreads } from "../../utils/leader-topics.js";
import { replaceSideItem, type SideItem } from "../../utils/side-column.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { Composer } from "../Composer.js";
import { NewThreadIcon } from "../library/library-icons.js";
import { ThreadOriginName, threadNameFromMessage } from "./thread-names.js";
import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { LeaderName } from "./SideChatLeaders.js";

/**
 * The draft of the leader's thread not started yet. The column holds one new thread per leader,
 * so its draft is that leader's, and another device's New side chat with it continues it.
 */
export function newSideChatDraftKey(leaderId: string): string {
  return sideComposerDraftKey(leaderId, "new");
}

/**
 * A thread about to start with a leader: an empty page over its own message box. Its first message
 * starts the thread, from the place the main view showed when it was opened (the leader is told),
 * and the item becomes that thread's conversation. Passages taken along with "Ask in new thread"
 * show what it's about.
 *
 * The place may be another leader's (`startedIn`): that leader is then told where the chat started
 * only when it is a quest, the one kind of place every leader can look up.
 */
export function NewSideChat({ item }: { item: Extract<SideItem, { kind: "new-chat" }> }) {
  const { id: itemId, leaderId, startedFrom } = item;
  // Items saved before `startedIn` existed were started in their own leader's view.
  const startedIn = item.startedIn ?? leaderId;
  const own = startedIn === leaderId;
  const origin = own || /^q-\d+$/.test(startedFrom ?? "") ? startedFrom : null;
  const draftKey = newSideChatDraftKey(leaderId);
  const passages = useStore((state) => state.composerDrafts.get(draftKey)?.annotations);
  const newThread = useMemo(
    () => ({
      start: async (text: string) => {
        const { thread } = await topicApi.startThread(
          leaderId,
          threadNameFromMessage(text),
          origin ?? undefined,
          text.slice(0, 400),
        );
        rememberThreads(leaderId, [thread], false);
        return thread.key;
      },
      started: (threadKey: string) => replaceSideItem(itemId, { kind: "conversation", threadKey, leaderId }),
    }),
    [itemId, leaderId, origin],
  );
  return (
    <ComposerFeedLayout>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="new-side-chat">
        <div className="max-w-xs text-center">
          <NewThreadIcon className="mx-auto mb-3 h-7 w-7 text-cc-muted/70" />
          <p className="flex items-center justify-center gap-1.5 text-sm text-cc-fg" data-testid="new-side-chat-with">
            A new thread with <LeaderName sessionId={leaderId} />
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-cc-muted">
            {origin ? (
              <>
                About <ThreadOriginName leaderId={startedIn} threadKey={origin} />, which stays as it is.
              </>
            ) : (
              "The conversation on the left stays as it is."
            )}
          </p>
          {passages?.map((passage) => (
            <blockquote
              key={passage.id}
              className="mt-4 line-clamp-4 border-l-2 border-cc-primary/60 pl-3 text-left text-[13px] leading-relaxed text-cc-muted"
            >
              {passage.selectedText}
            </blockquote>
          ))}
        </div>
      </div>
      <Composer
        sessionId={leaderId}
        threadKey={own ? (startedFrom ?? "main") : "main"}
        draftKey={draftKey}
        newThread={newThread}
        secondary
        autoFocus
      />
    </ComposerFeedLayout>
  );
}
