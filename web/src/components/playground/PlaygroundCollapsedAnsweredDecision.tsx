import { useEffect } from "react";
import { useStore } from "../../store.js";
import type { SessionNotification } from "../../types.js";
import type { FeedEntry, Turn } from "../../hooks/use-feed-model.js";
import type { ThreadResponsePresentation } from "../thread-response-presentation.js";
import { FeedEntries } from "../MessageFeedEntries.js";
import { ReadyThreadResponseRows } from "../ReadyThreadResponseRows.js";
import { TurnActivityDisclosure } from "../TurnActivitySummary.js";
import { Card } from "./shared.js";

// A few minutes ago, so message times in this demo read like real ones.
const PLAYGROUND_TIME = Date.now() - 5 * 60_000;

const SESSION_ID = "playground-collapsed-answered-decision";
const THREAD_KEY = "q-2042";
const NOTIFICATION_ID = "n-answered-decision";
const NOOP = () => {};

const ANSWER: Extract<FeedEntry, { kind: "message" }> = {
  kind: "message",
  msg: {
    id: "playground-answered-decision-answer",
    role: "assistant",
    content: "All three decisions are recorded and with the worker. The smoke run comes first, then the full check.",
    timestamp: PLAYGROUND_TIME + 1,
    historyIndex: 4,
    metadata: {
      leaderThreadRole: "answer",
      threadAnswer: { version: 2, answerUserMessageIds: ["u1"], observedHistoryLength: 4 },
    },
  },
};
// The server writes a needs-input prompt's context as its own message and anchors the card to it.
const CONTEXT: Extract<FeedEntry, { kind: "message" }> = {
  kind: "message",
  msg: {
    id: `needs-input-context-${NOTIFICATION_ID}`,
    role: "assistant",
    content:
      "The dataset passed the full check: 1,325 tasks are ready. Writing it to shared storage needs your go-ahead.\n\n" +
      "- **Write** under the `coding_tasks` name (recommended).\n- **Hold** and keep it in the stage folder.",
    timestamp: PLAYGROUND_TIME + 2,
    historyIndex: 9,
    metadata: { leaderThreadRole: "commentary" },
  },
};
const TURN: Turn = {
  id: "playground-answered-decision-user",
  userEntry: {
    kind: "message",
    msg: {
      id: "playground-answered-decision-user",
      role: "user",
      content: "Approve smoke + full.",
      timestamp: PLAYGROUND_TIME,
    },
  },
  allEntries: [ANSWER, CONTEXT],
  presentationEntries: [ANSWER, CONTEXT],
  agentEntries: [],
  systemEntries: [],
  notificationEntries: [ANSWER, CONTEXT],
  responseEntry: null,
  subConclusions: [],
  collapsedEntries: [],
  stats: { messageCount: 5, toolCount: 4, subagentCount: 0, herdEventCount: 15 },
};
const PRESENTATION: ThreadResponsePresentation = {
  ready: true,
  cutoverHistoryIndex: 0,
  pendingMessageCount: 0,
  currentResponses: [
    {
      response: {
        version: 2,
        threadKey: THREAD_KEY,
        questId: THREAD_KEY,
        answerUserMessageIds: ["u1"],
        referencedUserMessageIds: [TURN.id],
        coveredAnswerUserMessageIds: ["u1"],
        coveredUserMessageIds: [TURN.id],
        currentMessageId: ANSWER.msg.id,
        currentHistoryIndex: 4,
        createdAt: 4,
        updatedAt: 4,
        source: "explicit",
      },
      sourceTurnId: TURN.id,
      messageEntry: ANSWER,
      collapsedMessageEntry: ANSWER,
      referencedUserMessages: [{ historyMessageId: TURN.id, userMessageId: "u1", content: "Approve smoke + full." }],
    },
  ],
  currentResponseMessageIds: new Set([ANSWER.msg.id]),
  quizGroups: [],
  layoutSignature: "playground-answered-decision",
};
const NOTIFICATION: SessionNotification = {
  id: NOTIFICATION_ID,
  category: "needs-input",
  timestamp: PLAYGROUND_TIME + 2,
  messageId: CONTEXT.msg.id,
  contextMessageId: CONTEXT.msg.id,
  questionOnly: true,
  summary: "Approve writing the dataset to shared storage",
  questions: [
    { prompt: "Write the dataset, and under which name?", suggestedAnswers: ["Write, coding_tasks", "Hold"] },
  ],
  threadKey: THREAD_KEY,
  questId: THREAD_KEY,
  done: true,
  resolutionNotice: { source: "response", status: "delivered", resolvedAt: 3 },
};

function renderEntry(entry: FeedEntry) {
  return (
    <FeedEntries
      entries={[entry]}
      sessionId={SESSION_ID}
      currentThreadKey={THREAD_KEY}
      isCodexSession={false}
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={NOOP}
      onSelectThread={NOOP}
      questLinkSurface="chat-feed"
    />
  );
}

/** A Ready collapsed turn keeps its answered decision (context and card) after the answer. */
export function PlaygroundCollapsedAnsweredDecision() {
  useEffect(() => {
    const previous = useStore.getState().sessionNotifications.get(SESSION_ID);
    useStore.setState((state) => ({
      sessionNotifications: new Map(state.sessionNotifications).set(SESSION_ID, [NOTIFICATION]),
    }));
    return () => {
      useStore.setState((state) => {
        const sessionNotifications = new Map(state.sessionNotifications);
        if (previous) sessionNotifications.set(SESSION_ID, previous);
        else sessionNotifications.delete(SESSION_ID);
        return { sessionNotifications };
      });
    };
  }, []);

  return (
    <Card label="Collapsed Ready · answer, then the answered decision it led to">
      <div
        className="min-w-0 w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
        data-testid="playground-collapsed-answered-decision"
      >
        <TurnActivityDisclosure stats={TURN.stats} durationMs={null} expanded={false} onToggle={NOOP} />
        <ReadyThreadResponseRows
          turn={TURN}
          presentation={PRESENTATION}
          needsInputAnchorMessageIds={new Set([CONTEXT.msg.id])}
          renderEntry={renderEntry}
          sessionId={SESSION_ID}
          currentThreadKey={THREAD_KEY}
          onSelectThread={NOOP}
          questLinkSurface="chat-feed"
        />
      </div>
    </Card>
  );
}
