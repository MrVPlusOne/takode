import { useMemo } from "react";
import { useStore } from "../../store.js";
import { topicApi } from "../../api/topics.js";
import { rememberThreads } from "../../utils/leader-topics.js";
import { replaceSideItem } from "../../utils/side-column.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { Composer } from "../Composer.js";
import { NewThreadIcon } from "../library/library-icons.js";
import { ThreadOriginName, threadNameFromMessage } from "./thread-names.js";
import { sideDraftKey } from "./SideConversation.js";

/** The draft of a side chat not started yet, kept per side column item. */
export function newSideChatDraftKey(leaderId: string, itemId: string): string {
  return sideDraftKey(leaderId, `new:${itemId}`);
}

/**
 * A side chat about to start: an empty page over its own message box. Its first message starts a
 * thread with the leader, from the place it was opened on (the leader is told), and the item becomes
 * that thread's conversation. Passages taken along with "Ask in side chat" show what it's about.
 */
export function NewSideChat({
  leaderId,
  itemId,
  startedFrom,
}: {
  leaderId: string;
  itemId: string;
  startedFrom: string | null;
}) {
  const draftKey = newSideChatDraftKey(leaderId, itemId);
  const passages = useStore((state) => state.composerDrafts.get(draftKey)?.annotations);
  const newThread = useMemo(
    () => ({
      start: async (text: string) => {
        const { thread } = await topicApi.startThread(
          leaderId,
          threadNameFromMessage(text),
          startedFrom ?? undefined,
          text.slice(0, 400),
        );
        rememberThreads(leaderId, [thread], false);
        return thread.key;
      },
      started: (threadKey: string) => replaceSideItem(leaderId, itemId, { kind: "conversation", threadKey }),
    }),
    [itemId, leaderId, startedFrom],
  );
  return (
    <ComposerFeedLayout>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="new-side-chat">
        <div className="max-w-xs text-center">
          <NewThreadIcon className="mx-auto mb-3 h-7 w-7 text-cc-muted/70" />
          <p className="text-sm text-cc-fg">A side chat with the leader</p>
          <p className="mt-1 text-[13px] leading-relaxed text-cc-muted">
            {startedFrom ? (
              <>
                About <ThreadOriginName leaderId={leaderId} threadKey={startedFrom} />, which stays as it is.
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
        threadKey={startedFrom ?? "main"}
        draftKey={draftKey}
        newThread={newThread}
        secondary
        autoFocus
      />
    </ComposerFeedLayout>
  );
}
