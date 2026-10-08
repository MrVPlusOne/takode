import { useEffect, useMemo, useState } from "react";
import { buildThreadWindowSync } from "../../../shared/thread-window.js";
import { buildFeedModel } from "../../hooks/use-feed-model.js";
import { useStore } from "../../store.js";
import type { BrowserIncomingMessage } from "../../types.js";
import { buildFeedMessageModel } from "../../utils/feed-render-model.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { buildFeedSections } from "../message-feed-sections.js";
import { TurnEntries } from "../MessageFeedTurns.js";
import { Card, Section } from "./shared.js";

const SESSION_ID = "playground-quest-completion-summary";
const QUEST_ID = "q-9008";
const EMPTY_IDS = new Set<string>();
const NOOP = () => {};
const route = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
};

function message(type: "user" | "assistant", id: string, text: string, index: number): BrowserIncomingMessage {
  const timestamp = 1_700_000_000_000 + index * 60_000;
  if (type === "user") {
    return {
      type: "user_message",
      id,
      content: text,
      timestamp,
      agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      ...route,
    };
  }
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...route,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

/** The Memory wrap-up turn a leader runs when the worker finishes the quest. */
function wrapUpSections(wrapUpText: string) {
  const history = [
    message("user", "herd-work", "1 event from 1 session\n\n#12 | turn_end | Work handed off to Memory", 0),
    message("assistant", "work-note", "Work is synced; the worker is running Memory.", 1),
    message("user", "herd-memory", "1 event from 1 session\n\n#12 | turn_end | quest completed", 2),
    message("assistant", "wrap-up", wrapUpText, 3),
  ];
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem: 0,
    itemCount: history.length,
    sectionItemCount: history.length,
    visibleItemCount: history.length,
  });
  const feed = buildFeedMessageModel({
    leaderSessionId: SESSION_ID,
    threadKey: QUEST_ID,
    projectThreadRoutes: true,
    allMessages: [],
    historyLoading: false,
    selectedFeedWindowEnabled: true,
    selectedFeedWindow: sync.window,
    selectedFeedWindowMessages: sync.entries.flatMap((entry) =>
      normalizeHistoryMessageToChatMessages(entry.message, entry.history_index),
    ),
  });
  return buildFeedSections(buildFeedModel(feed.messages, true, 0, undefined, null, undefined, true).turns);
}

function CompletedQuestThread({ wrapUpText, testId }: { wrapUpText: string; testId: string }) {
  const sections = useMemo(() => wrapUpSections(wrapUpText), [wrapUpText]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_IDS);
  return (
    <div className="max-w-[430px] space-y-3 rounded-xl bg-cc-bg p-3" data-testid={testId}>
      <TurnEntries
        sections={sections}
        sessionId={SESSION_ID}
        currentThreadKey={QUEST_ID}
        leaderMode
        leaderSession
        showInlineMessageTiming={false}
        isCodexSession={false}
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
        activeNeedsInputAnchorMessageIds={EMPTY_IDS}
        visibleThreadStatuses={[]}
      />
    </div>
  );
}

export function PlaygroundQuestCompletionSummary() {
  useEffect(() => {
    useStore.setState((state) => ({
      questDetails: new Map(state.questDetails).set(QUEST_ID, {
        id: "playground-completion-summary",
        questId: QUEST_ID,
        version: 1,
        title: "Speed up quest writes",
        description: "Make quest writes and reads fast.",
        status: "done",
        createdAt: 1,
        completedAt: 2,
        verificationItems: [],
        debriefTldr:
          "- Quest reads now come from an in-memory store, so `takode board show` dropped from ~300 ms to ~20 ms.\n- Writes still re-serialize the store and take about 100 ms.",
        debrief:
          "Quest reads and board views were slow because every request re-read and parsed the whole quest store from disk. The server now keeps a deep-frozen in-memory copy and checks the file's identity before trusting it, so another process rewriting the file is still picked up.\n\nWrites still serialize the full store, which accounts for the remaining ~100 ms per write. The live server shows the new timings only after it restarts onto this build.",
        quizItems: [
          {
            id: "why-slow",
            question: "Why did a single quest read take 150-360 ms before this change?",
            answer: "Every request re-read and parsed the whole quest store from disk.",
          },
        ],
      }),
    }));
  }, []);

  return (
    <Section
      title="Quest Complete Summary"
      description="A completed quest's leader thread shows its final debrief TLDR, expandable to the full debrief, above the Quiz, or at the end of the thread when no Quiz was posted. Both stay visible when the wrap-up turn is collapsed."
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card label="Quiz-only wrap-up turn · summary above Quiz">
          <CompletedQuestThread
            wrapUpText={`{[(Quest Quiz: ${QUEST_ID})]}`}
            testId="playground-completion-summary-quiz"
          />
        </Card>
        <Card label="Wrap-up without a Quiz · summary ends the thread">
          <CompletedQuestThread wrapUpText="Quest closed." testId="playground-completion-summary-no-quiz" />
        </Card>
      </div>
    </Section>
  );
}
