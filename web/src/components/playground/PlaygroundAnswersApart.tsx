import { useEffect } from "react";
import type { FeedEntry, Turn } from "../../hooks/use-feed-model.js";
import { useStore } from "../../store.js";
import { FeedEntries } from "../MessageFeedEntries.js";
import { QuestCompletionSummaryCard } from "../QuestCompletionSummaryCard.js";
import { ReadyThreadResponseRows } from "../ReadyThreadResponseRows.js";
import type { ThreadResponsePresentation } from "../thread-response-presentation.js";
import { TurnActivityDisclosure } from "../TurnActivitySummary.js";
import { Card } from "./shared.js";

const SESSION_ID = "playground-answers-apart";
const QUEST_ID = "q-9031";
const START = 1_700_000_000_000;
const MINUTE = 60_000;
const NOOP = () => {};

function answer(id: string, content: string, minutes: number, historyIndex: number, answerIds: string[]) {
  return {
    kind: "message" as const,
    msg: {
      id,
      role: "assistant" as const,
      content,
      timestamp: START + minutes * MINUTE,
      historyIndex,
      metadata: {
        leaderThreadRole: "answer" as const,
        threadKey: QUEST_ID,
        threadAnswer: { version: 2 as const, answerUserMessageIds: answerIds, observedHistoryLength: historyIndex },
      },
    },
  };
}

const REQUEST_ID = "playground-answers-apart-request";
const DRAFT_ANSWER = answer(
  "playground-answers-apart-draft",
  "The pull request is open as a draft. It is one commit on the launch branch, and the merge waits for review.",
  1,
  2,
  ["u70"],
);
// An hour later, in the same leader turn: a new result that names no message.
const MERGED_RESULT = answer(
  "playground-answers-apart-merged",
  "The new data is merged into the launch branch after the review approved it. All checks passed.",
  62,
  9,
  [],
);
const TURN: Turn = {
  id: REQUEST_ID,
  userEntry: {
    kind: "message",
    msg: { id: REQUEST_ID, role: "user", content: "Open the PR against the launch branch.", timestamp: START },
  },
  allEntries: [DRAFT_ANSWER, MERGED_RESULT],
  presentationEntries: [DRAFT_ANSWER, MERGED_RESULT],
  agentEntries: [],
  systemEntries: [],
  notificationEntries: [DRAFT_ANSWER, MERGED_RESULT],
  responseEntry: MERGED_RESULT,
  subConclusions: [],
  collapsedEntries: [],
  stats: { messageCount: 16, toolCount: 13, subagentCount: 0, herdEventCount: 11 },
};

function response(entry: typeof DRAFT_ANSWER, referenced: string[], answerIds: string[]) {
  return {
    response: {
      version: 2 as const,
      threadKey: QUEST_ID,
      questId: QUEST_ID,
      answerUserMessageIds: answerIds,
      referencedUserMessageIds: referenced,
      coveredAnswerUserMessageIds: answerIds,
      coveredUserMessageIds: referenced,
      currentMessageId: entry.msg.id,
      currentHistoryIndex: entry.msg.historyIndex,
      createdAt: entry.msg.timestamp,
      updatedAt: entry.msg.timestamp,
      source: "explicit" as const,
    },
    sourceTurnId: TURN.id,
    messageEntry: entry as Extract<FeedEntry, { kind: "message" }>,
    collapsedMessageEntry: entry as Extract<FeedEntry, { kind: "message" }>,
    referencedUserMessages: referenced.map((historyMessageId) => ({
      historyMessageId,
      userMessageId: "u70",
      content: "Open the PR against the launch branch.",
    })),
  };
}

const PRESENTATION: ThreadResponsePresentation = {
  ready: true,
  cutoverHistoryIndex: 0,
  pendingMessageCount: 0,
  currentResponses: [response(DRAFT_ANSWER, [REQUEST_ID], ["u70"]), response(MERGED_RESULT, [], [])],
  currentResponseMessageIds: new Set([DRAFT_ANSWER.msg.id, MERGED_RESULT.msg.id]),
  quizGroups: [],
  layoutSignature: "playground-answers-apart",
};

function renderEntry(entry: FeedEntry) {
  return (
    <FeedEntries
      entries={[entry]}
      sessionId={SESSION_ID}
      currentThreadKey={QUEST_ID}
      isCodexSession={false}
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={NOOP}
      questLinkSurface="chat-feed"
    />
  );
}

/**
 * Two answers an hour apart in one leader turn, with the quest completing between
 * them: the later result is marked as new and set off by a rule, and the Quest
 * complete card sits at its completion time instead of under the later result.
 */
export function PlaygroundAnswersApart() {
  useEffect(() => {
    useStore.setState((state) => ({
      questDetails: new Map(state.questDetails).set(QUEST_ID, {
        id: "playground-answers-apart-quest",
        questId: QUEST_ID,
        version: 1,
        title: "Add the new data to the launch mix",
        description: "Open and land the PR adding the new data.",
        status: "done",
        createdAt: 1,
        completedAt: START + 25 * MINUTE,
        verificationItems: [],
        debriefTldr: "The PR adds the new data to the launch mix; the merge waits for review.",
      }),
    }));
  }, []);

  return (
    <Card label="Answers an hour apart · new result, Quest complete at its time">
      <div
        className="min-w-0 w-full max-w-[430px] overflow-clip rounded-xl border border-cc-border/30 bg-cc-card/20"
        data-testid="playground-answers-apart"
      >
        <TurnActivityDisclosure stats={TURN.stats} durationMs={62 * MINUTE} expanded={false} onToggle={NOOP} />
        <ReadyThreadResponseRows
          turn={TURN}
          presentation={PRESENTATION}
          renderEntry={renderEntry}
          sessionId={SESSION_ID}
          currentThreadKey={QUEST_ID}
          questLinkSurface="chat-feed"
          timedCard={{
            at: START + 25 * MINUTE,
            node: <QuestCompletionSummaryCard questId={QUEST_ID} questLinkSurface="chat-feed" />,
          }}
        />
      </div>
    </Card>
  );
}
