import { useMemo, useState } from "react";
import { buildFeedModel } from "../../hooks/use-feed-model.js";
import {
  buildChronologicalAnswersWindow,
  chronologicalAnswersFixture,
} from "../../test-fixtures/chronological-answers.js";
import { buildFeedMessageModel } from "../../utils/feed-render-model.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { buildFeedSections } from "../message-feed-sections.js";
import { TurnEntries } from "../MessageFeedTurns.js";
import { resolveThreadResponses } from "../thread-response-presentation.js";
import { Section } from "./shared.js";

const EMPTY_IDS = new Set<string>();
const NOOP = () => {};

export function PlaygroundChronologicalAnswers() {
  const [threadKey, setThreadKey] = useState("main");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const { sections, presentation } = useMemo(() => {
    const sync = buildChronologicalAnswersWindow(threadKey);
    const messages = sync.entries.flatMap((entry) =>
      normalizeHistoryMessageToChatMessages(entry.message, entry.history_index),
    );
    const state = sync.threadResponseSupportComplete ? sync.threadResponseProjection : undefined;
    const feed = buildFeedMessageModel({
      leaderSessionId: chronologicalAnswersFixture.sessionId,
      threadKey,
      projectThreadRoutes: true,
      allMessages: [],
      historyLoading: false,
      selectedFeedWindowEnabled: true,
      selectedFeedWindow: sync.window,
      selectedFeedWindowMessages: messages,
      threadResponseState: state,
    });
    const sections = buildFeedSections(
      buildFeedModel(feed.messages, threadKey !== "main", 0, undefined, null, undefined, true).turns,
    );
    return {
      sections,
      presentation: resolveThreadResponses(sections, state, threadKey, true, feed.messagesAvailableForDerivation),
    };
  }, [threadKey]);

  return (
    <Section
      title="Chronological Answers"
      description="Late replies keep their place in the conversation. Answers previews still identify the earlier request."
    >
      <div data-testid="playground-chronological-answers" className="max-w-4xl space-y-3">
        <div className="flex gap-2">
          {[
            { key: "main", label: "Main" },
            { key: chronologicalAnswersFixture.threadKey, label: "Quest" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={threadKey === tab.key}
              className={`rounded border px-3 py-2 text-sm ${threadKey === tab.key ? "border-cc-primary/50 bg-cc-primary/15 text-cc-primary" : "border-cc-border text-cc-muted"}`}
              onClick={() => {
                setThreadKey(tab.key);
                setExpanded(EMPTY_IDS);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="max-h-[720px] space-y-3 overflow-y-auto rounded-xl bg-cc-bg p-3 sm:p-6">
          <TurnEntries
            sections={sections}
            sessionId={chronologicalAnswersFixture.sessionId}
            currentThreadKey={threadKey}
            leaderMode
            showInlineMessageTiming={false}
            isCodexSession
            activeCodexTerminalIds={EMPTY_IDS}
            onOpenCodexTerminal={NOOP}
            turnStates={sections.flatMap((section) =>
              section.turns.map((turn) => ({ defaultExpanded: false, isActivityExpanded: expanded.has(turn.id) })),
            )}
            toggleTurn={(turnId) =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(turnId)) next.delete(turnId);
                else next.add(turnId);
                return next;
              })
            }
            questLinkSurface="chat-feed"
            threadResponsePresentation={presentation}
            activeNeedsInputAnchorMessageIds={EMPTY_IDS}
            visibleThreadStatuses={[]}
          />
        </div>
      </div>
    </Section>
  );
}
