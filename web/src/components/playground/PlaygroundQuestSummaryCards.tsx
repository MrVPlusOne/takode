import { useEffect, useMemo, useState } from "react";
import { buildThreadWindowSync } from "../../../shared/thread-window.js";
import { buildFeedModel } from "../../hooks/use-feed-model.js";
import { useStore } from "../../store.js";
import type { BrowserIncomingMessage } from "../../types.js";
import { buildFeedMessageModel } from "../../utils/feed-render-model.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { buildFeedSections } from "../message-feed-sections.js";
import { MessageFeedCenteredState } from "../MessageFeedCenteredState.js";
import { TurnEntries } from "../MessageFeedTurns.js";
import { SupportingQuestAnswerContext } from "../QuestCompletionSummaryCard.js";
import { StartedQuestsContext } from "../QuestForkLinks.js";
import { Card, Section } from "./shared.js";

const SESSION_ID = "playground-quest-summary-cards";
const QUEST_ID = "q-9008";
const DESCRIPTION_QUEST_ID = "q-9021";
const EXCERPT_QUEST_ID = "q-9022";
const SUPPORTING_RUNNING_ID = "q-9024";
const SUPPORTING_DONE_ID = "q-9025";
const EMPTY_IDS = new Set<string>();
const NOOP = () => {};

function messageTimestamp(index: number): number {
  return 1_700_000_000_000 + index * 60_000;
}

function message(
  questId: string,
  type: "herd" | "human" | "assistant",
  id: string,
  text: string,
  index: number,
): BrowserIncomingMessage {
  const timestamp = messageTimestamp(index);
  const route = {
    threadKey: questId,
    questId,
    threadRefs: [{ threadKey: questId, questId, source: "explicit" as const }],
  };
  if (type !== "assistant") {
    return {
      type: "user_message",
      id,
      content: text,
      timestamp,
      ...(type === "herd" ? { agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" } } : {}),
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
function wrapUpHistory(wrapUpText: string): BrowserIncomingMessage[] {
  return [
    message(QUEST_ID, "herd", "herd-work", "1 event from 1 session\n\n#12 | turn_end | Work handed off to Memory", 0),
    message(QUEST_ID, "assistant", "work-note", "Work is synced; the worker is running Memory.", 1),
    message(QUEST_ID, "herd", "herd-memory", "1 event from 1 session\n\n#12 | turn_end | quest completed", 2),
    message(QUEST_ID, "assistant", "wrap-up", wrapUpText, 3),
  ];
}

/** The wrap-up followed by a later question from the user and the leader's reply. */
function laterExchangeHistory(): BrowserIncomingMessage[] {
  return [
    ...wrapUpHistory("Quest closed."),
    message(QUEST_ID, "human", "later-request", "Do the faster reads need a server restart?", 4),
    message(QUEST_ID, "assistant", "later-reply", "Yes, the live server shows them after it restarts.", 5),
  ];
}

/** A just-dispatched quest thread: only worker events and leader board updates, no prose. */
/** The request moved into `questId`, which it now continues in; its first thread still shows it. */
function handedOff(request: BrowserIncomingMessage, questId: string): BrowserIncomingMessage {
  if (request.type !== "user_message") return request;
  const ref = { threadKey: questId, questId, source: "explicit" as const, attachedAt: request.timestamp + 1 };
  return { ...request, threadRefs: [...(request.threadRefs ?? []), ref] };
}

function dispatchHistory(questId: string): BrowserIncomingMessage[] {
  return [
    message(questId, "herd", `${questId}-dispatch`, "1 event from 1 session\n\n#12 | quest_claimed | Work started", 0),
    message(questId, "assistant", `${questId}-board`, "Recorded the quest on the board.", 1),
  ];
}

function threadSections(questId: string, history: BrowserIncomingMessage[]) {
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: questId,
    fromItem: 0,
    itemCount: history.length,
    sectionItemCount: history.length,
    visibleItemCount: history.length,
  });
  const feed = buildFeedMessageModel({
    leaderSessionId: SESSION_ID,
    threadKey: questId,
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

function QuestThread({
  questId,
  history,
  testId,
  onSelectThread,
}: {
  questId: string;
  history: BrowserIncomingMessage[];
  testId: string;
  onSelectThread?: (threadKey: string) => void;
}) {
  const sections = useMemo(() => threadSections(questId, history), [questId, history]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_IDS);
  return (
    <div className="max-w-[430px] space-y-3 rounded-xl bg-cc-bg p-3" data-testid={testId}>
      <TurnEntries
        sections={sections}
        sessionId={SESSION_ID}
        currentThreadKey={questId}
        onSelectThread={onSelectThread}
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
        needsInputAnchorMessageIds={EMPTY_IDS}
        visibleThreadStatuses={[]}
      />
    </div>
  );
}

export function PlaygroundQuestCompletionSummary() {
  useEffect(() => {
    useStore.setState((state) => ({
      questDetails: new Map(state.questDetails)
        .set(QUEST_ID, {
          id: "playground-completion-summary",
          questId: QUEST_ID,
          version: 1,
          title: "Speed up quest writes",
          description: "Make quest writes and reads fast.",
          status: "done",
          createdAt: 1,
          // Between the work note and the herd event reporting the completion.
          completedAt: messageTimestamp(1) + 30_000,
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
        })
        .set(SUPPORTING_DONE_ID, {
          id: "playground-completion-summary-supporting",
          questId: SUPPORTING_DONE_ID,
          version: 1,
          title: "QA eval trend numbers from Condor",
          description: "Read-only: QA eval trend numbers from Condor, to compare with the laptop worker's check.",
          status: "done",
          createdAt: 1,
          // Before the worker event that completes the dispatch-only thread.
          completedAt: messageTimestamp(1) + 30_000,
          verificationItems: [],
          debriefTldr:
            "- Condor rollouts confirm Frank's chart is the 77B T3 run; exec dips slightly, seeded QA rises.",
          relationships: { startedFrom: SUPPORTING_STARTED_FROM },
        }),
      questTitlePreviews: new Map(state.questTitlePreviews).set(EXCERPT_QUEST_ID, {
        questId: EXCERPT_QUEST_ID,
        title: "Show quest summaries in quest threads",
        version: 1,
      }),
    }));
  }, []);

  return (
    <Section
      title="Quest Complete Summary"
      description="A completed quest's leader thread shows its final debrief TLDR, expandable to the full debrief, at the moment the quest completed: in time order among the messages of the turn that was running then, so later answers and messages stay below it. It stays visible when that turn is collapsed."
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card label="Quiz-only wrap-up turn · summary before the wrap-up and its Quiz">
          <QuestThread
            questId={QUEST_ID}
            history={wrapUpHistory(`{[(Quest Quiz: ${QUEST_ID})]}`)}
            testId="playground-completion-summary-quiz"
          />
        </Card>
        <Card label="Wrap-up without a Quiz · summary ends the wrap-up turn">
          <QuestThread
            questId={QUEST_ID}
            history={wrapUpHistory("Quest closed.")}
            testId="playground-completion-summary-no-quiz"
          />
        </Card>
        <Card label="Later messages · summary stays where the quest completed">
          <QuestThread
            questId={QUEST_ID}
            history={laterExchangeHistory()}
            testId="playground-completion-summary-later"
          />
        </Card>
        <Card label="Supporting quest · leads with the answer given where the user asked">
          <SupportingQuestAnswerContext.Provider value={SUPPORTING_ANSWERS}>
            <QuestThread
              questId={SUPPORTING_DONE_ID}
              history={dispatchHistory(SUPPORTING_DONE_ID)}
              testId="playground-completion-summary-supporting"
            />
          </SupportingQuestAnswerContext.Provider>
        </Card>
      </div>
    </Section>
  );
}

const STARTED_FROM = {
  sessionId: SESSION_ID,
  messageId: `${EXCERPT_QUEST_ID}-ask`,
  threadKey: EXCERPT_QUEST_ID,
  timestamp: messageTimestamp(2),
};
/** The excerpt quest's thread holds the user's message the DevBox quest was filed from. */
const STARTED_QUESTS = new Map([
  [
    STARTED_FROM.messageId,
    [
      {
        questId: DESCRIPTION_QUEST_ID,
        title: "Set up the DevBox as a Takode host",
        startedFrom: STARTED_FROM,
        sideQuest: false,
      },
    ],
  ],
]);

/** One request in the excerpt quest's thread that two supporting quests help answer there. */
const SUPPORTING_STARTED_FROM = {
  sessionId: SESSION_ID,
  messageId: `${EXCERPT_QUEST_ID}-compare`,
  threadKey: EXCERPT_QUEST_ID,
  timestamp: messageTimestamp(3),
};
const SUPPORTING_QUESTS = new Map([
  [
    SUPPORTING_STARTED_FROM.messageId,
    [
      {
        questId: SUPPORTING_RUNNING_ID,
        title: "QA eval trend numbers from the laptop",
        startedFrom: SUPPORTING_STARTED_FROM,
        sideQuest: true,
      },
      {
        questId: SUPPORTING_DONE_ID,
        title: "QA eval trend numbers from Condor",
        startedFrom: SUPPORTING_STARTED_FROM,
        sideQuest: true,
      },
      // Filed as a side quest, but the user then wrote in its tab, so the conversation continues there.
      {
        questId: "q-9026",
        title: "Compare the eval prompts across runs",
        startedFrom: SUPPORTING_STARTED_FROM,
        sideQuest: false,
      },
    ],
  ],
]);
const SUPPORTING_ANSWERS = new Map([
  [
    SUPPORTING_DONE_ID,
    {
      messageId: `${EXCERPT_QUEST_ID}-combined-answer`,
      threadKey: EXCERPT_QUEST_ID,
      timestamp: messageTimestamp(6),
      markdown:
        "Both checks are in, and they agree. **Frank's chart is the 77B Big Climb T3 run, not 12B.** Our seeded-QA eval is flat to rising in every run.",
    },
  ],
]);

export function PlaygroundQuestDescriptionSummary() {
  useEffect(() => {
    useStore.setState((state) => ({
      questDetails: new Map(state.questDetails)
        .set(DESCRIPTION_QUEST_ID, {
          id: "playground-description-summary",
          questId: DESCRIPTION_QUEST_ID,
          version: 1,
          title: "Set up the DevBox as a Takode host",
          status: "in_progress",
          createdAt: 1,
          sessionId: "playground-worker",
          claimedAt: 2,
          tldr: "Register the DevBox as a Takode host so workers can run on its GPUs, then prove one worker session runs there end to end.",
          // Filed from the user's message in the q-9022 thread below.
          relationships: { startedFrom: STARTED_FROM },
          description:
            "## Background\nThe DevBox has idle GPUs, but Takode can only run sessions on this Mac.\n\n## Goal\n- Register the DevBox as a host with `takode node`.\n- Keep the reverse tunnel running across reboots.\n- Spawn one worker on the DevBox and confirm its tools run there.",
        })
        .set(EXCERPT_QUEST_ID, {
          id: "playground-description-excerpt",
          questId: EXCERPT_QUEST_ID,
          version: 1,
          title: "Show quest summaries in quest threads",
          status: "refined",
          createdAt: 1,
          description:
            "## Background\nLeader quest threads often begin with nothing but tool activity, so the feed never says what the quest is about. Completed threads already end with a Quest complete card built from the final debrief, and this quest adds the matching card at the start of the thread.\n\n## Goal\nShow the description TLDR, expandable to the full description.",
        }),
    }));
  }, []);

  return (
    <Section
      title="Quest Description Summary"
      description="A leader quest thread opens with what the quest is about: the description TLDR, expandable to the full description, or a description excerpt when the quest has no TLDR. It shows once, before the first turn, and only when the thread's first section is loaded; a quest thread with no messages shows it in place of the empty placeholder. A quest filed from one of the user's messages opens with a link back to that message, and the message links on to the quest (Continued in, or Side quest when the answer comes back where it was asked)."
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card label="Dispatch-only thread · description TLDR, started from a message">
          <QuestThread
            questId={DESCRIPTION_QUEST_ID}
            history={dispatchHistory(DESCRIPTION_QUEST_ID)}
            testId="playground-description-summary-tldr"
          />
        </Card>
        <Card label="Quest without a TLDR · description excerpt, message continued in another quest">
          <StartedQuestsContext.Provider value={STARTED_QUESTS}>
            <QuestThread
              questId={EXCERPT_QUEST_ID}
              history={[
                ...dispatchHistory(EXCERPT_QUEST_ID),
                handedOff(
                  message(
                    EXCERPT_QUEST_ID,
                    "human",
                    STARTED_FROM.messageId,
                    "Also set up the DevBox as a host, separately from this.",
                    2,
                  ),
                  DESCRIPTION_QUEST_ID,
                ),
              ]}
              testId="playground-description-summary-excerpt"
              onSelectThread={NOOP}
            />
          </StartedQuestsContext.Provider>
        </Card>
        <Card label="Side quests under the request · each opens its thread; one the user wrote in reads Continued in">
          <StartedQuestsContext.Provider value={SUPPORTING_QUESTS}>
            <QuestThread
              questId={EXCERPT_QUEST_ID}
              history={[
                message(
                  EXCERPT_QUEST_ID,
                  "human",
                  SUPPORTING_STARTED_FROM.messageId,
                  "Check this on both the laptop and Condor, then compare.",
                  3,
                ),
                message(
                  EXCERPT_QUEST_ID,
                  "assistant",
                  `${EXCERPT_QUEST_ID}-dispatch-both`,
                  "Sent to both workers; I'll compare and answer here.",
                  4,
                ),
              ]}
              testId="playground-supporting-quest-rows"
              onSelectThread={NOOP}
            />
          </StartedQuestsContext.Provider>
        </Card>
        <Card label="Quest thread with no messages · card replaces the empty placeholder">
          <div
            className="flex h-[260px] max-w-[430px] flex-col rounded-xl bg-cc-bg"
            data-testid="playground-description-summary-empty"
          >
            <MessageFeedCenteredState
              variant="empty"
              topControls={null}
              clearancePx={0}
              sessionId={SESSION_ID}
              threadKey={DESCRIPTION_QUEST_ID}
              onVisibleHeightChange={NOOP}
              questId={DESCRIPTION_QUEST_ID}
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
