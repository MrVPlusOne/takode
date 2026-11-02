import { useMemo, useState } from "react";
import { buildFeedModel } from "../../hooks/use-feed-model.js";
import { buildFinalFoldWindow, finalFoldFixture } from "../../test-fixtures/final-fold.js";
import { buildFeedMessageModel } from "../../utils/feed-render-model.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { buildFeedSections } from "../message-feed-sections.js";
import { TurnEntries } from "../MessageFeedTurns.js";
import { resolveThreadResponses } from "../thread-response-presentation.js";
import { collapsedPresentationForTurn, turnFinalFold } from "../turn-final-fold.js";
import { Section } from "./shared.js";

const EMPTY_IDS = new Set<string>();
const NOOP = () => {};

/** A quest thread's latest turn folded before its newest final message, as a Waiting thread shows it. */
export function PlaygroundFinalFold() {
  const [expanded, setExpanded] = useState(false);
  const { sections, presentation, fold } = useMemo(() => {
    const sync = buildFinalFoldWindow();
    const threadKey = finalFoldFixture.threadKey;
    const messages = sync.entries.flatMap((entry) =>
      normalizeHistoryMessageToChatMessages(entry.message, entry.history_index),
    );
    const state = sync.threadResponseSupportComplete ? sync.threadResponseProjection : undefined;
    const feed = buildFeedMessageModel({
      leaderSessionId: finalFoldFixture.sessionId,
      threadKey,
      projectThreadRoutes: true,
      allMessages: [],
      historyLoading: false,
      selectedFeedWindowEnabled: true,
      selectedFeedWindow: sync.window,
      selectedFeedWindowMessages: messages,
      threadResponseState: state,
    });
    const sections = buildFeedSections(buildFeedModel(feed.messages, true, 0, undefined, null, undefined, true).turns);
    const presentation = resolveThreadResponses(sections, state, threadKey, true, feed.messagesAvailableForDerivation);
    const turn = sections.at(-1)?.turns.at(-1);
    const fold = turn ? turnFinalFold(turn, collapsedPresentationForTurn(turn, presentation, null), EMPTY_IDS) : null;
    return { sections, presentation, fold };
  }, []);

  return (
    <Section
      title="Folded Latest Turn"
      description="Once a leader thread's latest turn has a final message, the commentary and activity before it fold away; what came after stays open."
    >
      <div data-testid="playground-final-fold" className="max-w-4xl">
        <div className="max-h-[720px] space-y-3 overflow-y-auto rounded-xl bg-cc-bg p-3 sm:p-6">
          <TurnEntries
            sections={sections}
            sessionId={finalFoldFixture.sessionId}
            currentThreadKey={finalFoldFixture.threadKey}
            leaderSession
            showInlineMessageTiming={false}
            isCodexSession={false}
            activeCodexTerminalIds={EMPTY_IDS}
            onOpenCodexTerminal={NOOP}
            turnStates={sections.flatMap((section) =>
              section.turns.map(() => ({ defaultExpanded: false, isActivityExpanded: expanded, finalFold: fold })),
            )}
            toggleTurn={() => setExpanded((current) => !current)}
            questLinkSurface="chat-feed"
            threadResponsePresentation={presentation}
            needsInputAnchorMessageIds={EMPTY_IDS}
            visibleThreadStatuses={[]}
          />
        </div>
      </div>
    </Section>
  );
}
