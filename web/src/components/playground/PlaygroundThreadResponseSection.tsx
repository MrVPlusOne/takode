import type { FeedEntry, Turn } from "../../hooks/use-feed-model.js";
import type { ThreadResponsePresentation } from "../thread-response-presentation.js";
import { FeedEntries } from "../MessageFeedEntries.js";
import { ReadyThreadResponseRows } from "../ReadyThreadResponseRows.js";
import { TurnActivityDisclosure } from "../TurnActivitySummary.js";
import { TurnEntriesExpanded } from "../MessageFeedTurns.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";
import { PlaygroundChronologicalAnswers } from "./PlaygroundChronologicalAnswers.js";
import { PlaygroundAnswersApart } from "./PlaygroundAnswersApart.js";
import { PlaygroundCollapsedAnsweredDecision } from "./PlaygroundCollapsedAnsweredDecision.js";
import { PlaygroundQuestCompletionSummary, PlaygroundQuestDescriptionSummary } from "./PlaygroundQuestSummaryCards.js";

const SESSION_ID = "playground-thread-responses";

function assistantEntry(
  id: string,
  content: string,
  leaderThreadRole?: "commentary" | "answer" | "response",
): Extract<FeedEntry, { kind: "message" }> {
  return {
    kind: "message",
    msg: {
      id,
      role: "assistant",
      content,
      timestamp: 1,
      metadata: {
        leaderThreadRole,
        ...(leaderThreadRole === "answer"
          ? { threadAnswer: { version: 2 as const, answerUserMessageIds: ["u1", "u2"], observedHistoryLength: 7 } }
          : {}),
      },
    },
  };
}

const GROUPED_COVERED_USER_MESSAGES = [
  {
    historyMessageId: "playground-user-first",
    userMessageId: "u1",
    content: "Please foreground the polished result when this work is ready.",
  },
  {
    historyMessageId: "playground-user-second",
    userMessageId: "u2",
    content: "Please include the mobile behavior too.",
  },
] as const;

const CURRENT_RESPONSE = assistantEntry(
  "playground-response-current",
  "The later answer adds the final mobile result without compressing the detailed answer above it.",
  "answer",
);
const EARLIER_RESPONSE = assistantEntry(
  "playground-response-earlier",
  "The responsive feed now keeps this detailed accepted-Work answer visible for both requests, including the reasoning and remaining uncertainty.",
  "answer",
);
const INTERMEDIATE = assistantEntry(
  "playground-response-intermediate",
  "Intermediate investigation detail that belongs only in expanded chronology.",
  "commentary",
);
const READY_TURN: Turn = {
  id: "playground-user-second",
  userEntry: {
    kind: "message",
    msg: {
      id: "playground-user-second",
      role: "user",
      content: "Please include the mobile behavior too.",
      timestamp: 1,
    },
  },
  allEntries: [EARLIER_RESPONSE, INTERMEDIATE, CURRENT_RESPONSE],
  presentationEntries: [EARLIER_RESPONSE, INTERMEDIATE, CURRENT_RESPONSE],
  agentEntries: [INTERMEDIATE],
  systemEntries: [],
  notificationEntries: [EARLIER_RESPONSE, CURRENT_RESPONSE],
  responseEntry: null,
  subConclusions: [],
  collapsedEntries: [],
  stats: { messageCount: 1, toolCount: 2, subagentCount: 1, herdEventCount: 0 },
};
const PRESENTATION: ThreadResponsePresentation = {
  ready: true,
  cutoverHistoryIndex: 0,
  pendingMessageCount: 0,
  currentResponses: [
    {
      response: {
        version: 2,
        threadKey: "q-2042",
        questId: "q-2042",
        answerUserMessageIds: ["u1", "u2"],
        referencedUserMessageIds: ["playground-user-first", "playground-user-second"],
        coveredAnswerUserMessageIds: [],
        coveredUserMessageIds: [],
        currentMessageId: EARLIER_RESPONSE.msg.id,
        currentHistoryIndex: 6,
        createdAt: 6,
        updatedAt: 6,
        source: "explicit",
      },
      sourceTurnId: READY_TURN.id,
      messageEntry: EARLIER_RESPONSE,
      collapsedMessageEntry: EARLIER_RESPONSE,
      referencedUserMessages: GROUPED_COVERED_USER_MESSAGES,
    },
    {
      response: {
        version: 2,
        threadKey: "q-2042",
        questId: "q-2042",
        answerUserMessageIds: ["u1", "u2"],
        referencedUserMessageIds: ["playground-user-first", "playground-user-second"],
        coveredAnswerUserMessageIds: ["u1", "u2"],
        coveredUserMessageIds: ["playground-user-first", "playground-user-second"],
        currentMessageId: CURRENT_RESPONSE.msg.id,
        currentHistoryIndex: 7,
        createdAt: 7,
        updatedAt: 7,
        source: "explicit",
      },
      sourceTurnId: READY_TURN.id,
      messageEntry: CURRENT_RESPONSE,
      collapsedMessageEntry: CURRENT_RESPONSE,
      referencedUserMessages: GROUPED_COVERED_USER_MESSAGES,
    },
  ],
  currentResponseMessageIds: new Set([EARLIER_RESPONSE.msg.id, CURRENT_RESPONSE.msg.id]),
  quizGroups: [{ hostTurnId: READY_TURN.id, questIds: ["q-8"] }],
  layoutSignature: "playground-response-r2",
};
const ACTIVE_PRESENTATION: ThreadResponsePresentation = {
  ...PRESENTATION,
  ready: false,
  pendingMessageCount: 1,
  layoutSignature: "playground-response-r2-pending",
};
const QUIZ_PROMPT_BASE = assistantEntry(
  "playground-quiz-prompt",
  "Choose whether the follow-up should remain parked.\n\n{[(Quest Quiz: q-8)]}",
  "commentary",
);
const QUIZ_PROMPT: Extract<FeedEntry, { kind: "message" }> = {
  ...QUIZ_PROMPT_BASE,
  msg: {
    ...QUIZ_PROMPT_BASE.msg,
    historyIndex: 8,
    notification: {
      id: "playground-quiz-prompt-notification",
      category: "needs-input",
      summary: "Choose the follow-up boundary",
      timestamp: 8,
    },
  },
};
const QUIZ_PROMPT_TURN: Turn = {
  ...READY_TURN,
  allEntries: [...READY_TURN.allEntries, QUIZ_PROMPT],
  presentationEntries: [...READY_TURN.presentationEntries!, QUIZ_PROMPT],
};
const ANSWER_ONLY_RESPONSE = assistantEntry(
  "playground-answer-only-response",
  "The answer remains visible while the lightweight footer provides the only expansion action.",
  "answer",
);
const ANSWER_ONLY_TURN: Turn = {
  id: "playground-answer-only-user",
  userEntry: {
    kind: "message",
    msg: {
      id: "playground-answer-only-user",
      role: "user",
      content: "Show the answer-only collapsed state.",
      timestamp: 1,
    },
  },
  allEntries: [ANSWER_ONLY_RESPONSE],
  presentationEntries: [ANSWER_ONLY_RESPONSE],
  agentEntries: [],
  systemEntries: [],
  notificationEntries: [ANSWER_ONLY_RESPONSE],
  responseEntry: ANSWER_ONLY_RESPONSE,
  subConclusions: [],
  collapsedEntries: [{ kind: "entry", key: "entry:playground-answer-only-response", entry: ANSWER_ONLY_RESPONSE }],
  stats: { messageCount: 0, toolCount: 0, subagentCount: 0, herdEventCount: 0 },
};
const ANSWER_ONLY_PRESENTATION: ThreadResponsePresentation = {
  ...PRESENTATION,
  currentResponses: [
    {
      response: {
        ...PRESENTATION.currentResponses[0]!.response,
        answerUserMessageIds: ["u3"],
        referencedUserMessageIds: [ANSWER_ONLY_TURN.id],
        coveredAnswerUserMessageIds: ["u3"],
        coveredUserMessageIds: [ANSWER_ONLY_TURN.id],
        currentMessageId: ANSWER_ONLY_RESPONSE.msg.id,
      },
      sourceTurnId: ANSWER_ONLY_TURN.id,
      messageEntry: ANSWER_ONLY_RESPONSE,
      collapsedMessageEntry: ANSWER_ONLY_RESPONSE,
      referencedUserMessages: [
        {
          historyMessageId: ANSWER_ONLY_TURN.id,
          userMessageId: "u3",
          content: "Show the answer-only collapsed state.",
        },
      ],
    },
  ],
  currentResponseMessageIds: new Set([ANSWER_ONLY_RESPONSE.msg.id]),
  quizGroups: [],
  layoutSignature: "playground-answer-only-r1",
};
const CROSS_THREAD_RESPONSE_BASE = assistantEntry(
  "playground-cross-thread-answer",
  "Done. The follow-up landed in its own quest, so this answer links back to that thread.",
  "answer",
);
const CROSS_THREAD_RESPONSE: Extract<FeedEntry, { kind: "message" }> = {
  ...CROSS_THREAD_RESPONSE_BASE,
  msg: {
    ...CROSS_THREAD_RESPONSE_BASE.msg,
    metadata: {
      leaderThreadRole: "answer",
      threadKey: "q-2043",
      threadAnswer: { version: 2, answerUserMessageIds: ["u3"], observedHistoryLength: 7 },
    },
  },
};
const CROSS_THREAD_TURN: Turn = {
  ...ANSWER_ONLY_TURN,
  id: "playground-cross-thread-answer-turn",
  allEntries: [CROSS_THREAD_RESPONSE],
  presentationEntries: [CROSS_THREAD_RESPONSE],
  notificationEntries: [CROSS_THREAD_RESPONSE],
  responseEntry: CROSS_THREAD_RESPONSE,
  stats: { messageCount: 5, toolCount: 1, subagentCount: 0, herdEventCount: 0 },
};
const CROSS_THREAD_PRESENTATION: ThreadResponsePresentation = {
  ...ANSWER_ONLY_PRESENTATION,
  currentResponses: [
    {
      ...ANSWER_ONLY_PRESENTATION.currentResponses[0]!,
      response: {
        ...ANSWER_ONLY_PRESENTATION.currentResponses[0]!.response,
        currentMessageId: CROSS_THREAD_RESPONSE.msg.id,
      },
      sourceTurnId: CROSS_THREAD_TURN.id,
      messageEntry: CROSS_THREAD_RESPONSE,
      collapsedMessageEntry: CROSS_THREAD_RESPONSE,
    },
  ],
  currentResponseMessageIds: new Set([CROSS_THREAD_RESPONSE.msg.id]),
  layoutSignature: "playground-cross-thread-answer",
};
const COMMENT_ONLY_RESPONSE = assistantEntry(
  "playground-comment-only-answer",
  "Yes, this can be fixed properly: the stall check should treat a lease queue as a legitimate wait.",
  "answer",
);
const COMMENT_ONLY_TURN: Turn = {
  ...ANSWER_ONLY_TURN,
  id: "playground-comment-only-turn",
  allEntries: [COMMENT_ONLY_RESPONSE],
  presentationEntries: [COMMENT_ONLY_RESPONSE],
  notificationEntries: [COMMENT_ONLY_RESPONSE],
  responseEntry: COMMENT_ONLY_RESPONSE,
};
// The covered request was sent only as a comment on earlier text: empty content, structured comments.
// It came before this turn's own message, so the answer quotes it.
const COMMENT_ONLY_REQUEST_ID = "playground-comment-only-request";
const COMMENT_ONLY_PRESENTATION: ThreadResponsePresentation = {
  ...ANSWER_ONLY_PRESENTATION,
  currentResponses: [
    {
      ...ANSWER_ONLY_PRESENTATION.currentResponses[0]!,
      response: {
        ...ANSWER_ONLY_PRESENTATION.currentResponses[0]!.response,
        referencedUserMessageIds: [COMMENT_ONLY_REQUEST_ID],
        coveredUserMessageIds: [COMMENT_ONLY_REQUEST_ID],
        currentMessageId: COMMENT_ONLY_RESPONSE.msg.id,
      },
      sourceTurnId: COMMENT_ONLY_TURN.id,
      messageEntry: COMMENT_ONLY_RESPONSE,
      collapsedMessageEntry: COMMENT_ONLY_RESPONSE,
      referencedUserMessages: [
        {
          historyMessageId: COMMENT_ONLY_REQUEST_ID,
          userMessageId: "u3",
          content: "",
          annotations: [
            {
              id: "playground-comment-1",
              selectedText: "This stall alert is a false alarm. The worker is queued for the port lease.",
              comment: "Also is this something we can properly fix?",
            },
          ],
        },
      ],
    },
  ],
  currentResponseMessageIds: new Set([COMMENT_ONLY_RESPONSE.msg.id]),
  layoutSignature: "playground-comment-only-answer",
};
const ASSOCIATED_MAIN_RESPONSE_BASE = assistantEntry(
  "playground-associated-main-answer",
  "This Main answer remains visible here because its covered request is associated with this quest.",
  "answer",
);
const ASSOCIATED_MAIN_RESPONSE: Extract<FeedEntry, { kind: "message" }> = {
  ...ASSOCIATED_MAIN_RESPONSE_BASE,
  msg: {
    ...ASSOCIATED_MAIN_RESPONSE_BASE.msg,
    metadata: {
      leaderThreadRole: "answer",
      threadKey: "main",
      threadAnswer: { version: 2, answerUserMessageIds: ["u25"], observedHistoryLength: 25 },
    },
  },
};
const ASSOCIATED_MAIN_TURN: Turn = {
  id: "playground-associated-main-user",
  userEntry: {
    kind: "message",
    msg: {
      id: "playground-associated-main-user",
      role: "user",
      content: "Main request attached to this quest.",
      timestamp: 1,
      metadata: {
        leaderResponseCoverageVersion: 1,
        leaderUserMessageId: "u25",
        threadKey: "main",
        threadRefs: [{ threadKey: "q-2042", questId: "q-2042", source: "backfill" }],
      },
    },
  },
  allEntries: [ASSOCIATED_MAIN_RESPONSE],
  presentationEntries: [ASSOCIATED_MAIN_RESPONSE],
  agentEntries: [],
  systemEntries: [],
  notificationEntries: [ASSOCIATED_MAIN_RESPONSE],
  responseEntry: ASSOCIATED_MAIN_RESPONSE,
  subConclusions: [],
  collapsedEntries: [
    { kind: "entry", key: "entry:playground-associated-main-answer", entry: ASSOCIATED_MAIN_RESPONSE },
  ],
  stats: { messageCount: 0, toolCount: 1, subagentCount: 0, herdEventCount: 0 },
};
const ASSOCIATED_MAIN_PRESENTATION: ThreadResponsePresentation = {
  ...PRESENTATION,
  currentResponses: [
    {
      response: {
        version: 2,
        threadKey: "main",
        answerUserMessageIds: ["u25"],
        referencedUserMessageIds: [ASSOCIATED_MAIN_TURN.id],
        coveredAnswerUserMessageIds: [],
        coveredUserMessageIds: [],
        currentMessageId: ASSOCIATED_MAIN_RESPONSE.msg.id,
        currentHistoryIndex: 25,
        createdAt: 25,
        updatedAt: 25,
        source: "explicit",
      },
      sourceTurnId: ASSOCIATED_MAIN_TURN.id,
      messageEntry: ASSOCIATED_MAIN_RESPONSE,
      collapsedMessageEntry: ASSOCIATED_MAIN_RESPONSE,
      referencedUserMessages: [
        {
          historyMessageId: ASSOCIATED_MAIN_TURN.id,
          userMessageId: "u25",
          content: "Main request attached to this quest.",
        },
      ],
    },
  ],
  currentResponseMessageIds: new Set([ASSOCIATED_MAIN_RESPONSE.msg.id]),
  quizGroups: [],
  layoutSignature: "playground-associated-main-answer",
};

const MULTI_OWNER_RESPONSE: Extract<FeedEntry, { kind: "message" }> = {
  ...ASSOCIATED_MAIN_RESPONSE,
  msg: {
    ...ASSOCIATED_MAIN_RESPONSE.msg,
    id: "playground-shared-answer",
    content:
      "The shared answer covers both the Main request and this quest's request. Each tab keeps its own remaining questions.",
    metadata: {
      ...ASSOCIATED_MAIN_RESPONSE.msg.metadata,
      threadAnswer: {
        version: 2,
        answerUserMessageIds: ["u25", "u26"],
        observedHistoryLength: 26,
        authoredThreadKey: "q-2042",
        ownerGroups: [
          { threadKey: "main", userMessageIds: ["u25"] },
          { threadKey: "q-2042", userMessageIds: ["u26"] },
        ],
      },
    },
  },
};
const MULTI_OWNER_TURN: Turn = {
  ...ASSOCIATED_MAIN_TURN,
  id: "playground-shared-quest-user",
  allEntries: [MULTI_OWNER_RESPONSE],
  presentationEntries: [MULTI_OWNER_RESPONSE],
  notificationEntries: [MULTI_OWNER_RESPONSE],
  responseEntry: MULTI_OWNER_RESPONSE,
};
const MULTI_OWNER_PRESENTATION: ThreadResponsePresentation = {
  ...ASSOCIATED_MAIN_PRESENTATION,
  currentResponses: [
    {
      ...ASSOCIATED_MAIN_PRESENTATION.currentResponses[0]!,
      response: {
        ...ASSOCIATED_MAIN_PRESENTATION.currentResponses[0]!.response,
        answerUserMessageIds: ["u25", "u26"],
        referencedUserMessageIds: [ASSOCIATED_MAIN_TURN.id, MULTI_OWNER_TURN.id],
        coveredAnswerUserMessageIds: ["u26"],
        coveredUserMessageIds: [MULTI_OWNER_TURN.id],
        currentMessageId: MULTI_OWNER_RESPONSE.msg.id,
      },
      sourceTurnId: MULTI_OWNER_TURN.id,
      messageEntry: MULTI_OWNER_RESPONSE,
      collapsedMessageEntry: MULTI_OWNER_RESPONSE,
      referencedUserMessages: [
        { historyMessageId: ASSOCIATED_MAIN_TURN.id, userMessageId: "u25", content: "Please handle my Main request." },
        {
          historyMessageId: MULTI_OWNER_TURN.id,
          userMessageId: "u26",
          content: "Please include this quest's request in the same answer.",
        },
      ],
    },
  ],
  currentResponseMessageIds: new Set([MULTI_OWNER_RESPONSE.msg.id]),
  layoutSignature: "playground-shared-answer",
};

// A worker produced a report on its own schedule and the leader published it with
// `takode report`, then presented it with an answer that names no request
// ([thread:q-N:A]), which is marked as a new result. The collapsed
// turn keeps the report on screen above the answer, clipped with a toggle.
const PUBLISHED_REPORT: Extract<FeedEntry, { kind: "message" }> = {
  kind: "message",
  msg: {
    id: "playground-published-report",
    role: "assistant",
    content:
      "# Daily briefing: Tuesday\n\n## Needs you today\n\n- **Card payment:** statement balance due Monday.\n- **Two pipeline decisions** from the data leader.\n\n## Your to-dos\n\nNo changes.\n\n## What you got done\n\n- Reviewed the weights pull request.\n- Closed two stale quests.\n\n## Still waiting on you\n\n- **Benchmark checkpoint** (since last week): close or reassign.\n- **Slack reminder:** feedback submissions due Friday.",
    timestamp: 1,
    historyIndex: 1,
    metadata: {
      threadKey: "q-2042",
      markdownReport: {
        sessionId: SESSION_ID,
        reportId: "playground-published-report",
        sourcePath: "/home/user/.companion/artifacts/daily-briefing/briefing.md",
        sha256: "0f3a",
      },
    },
  },
};
const REPORT_ANSWER_BASE = assistantEntry(
  "playground-report-answer",
  "Today's 10 AM briefing is the report above. The card payment is the one thing due today.",
  "answer",
);
const REPORT_ANSWER = {
  ...REPORT_ANSWER_BASE,
  msg: {
    ...REPORT_ANSWER_BASE.msg,
    historyIndex: 2,
    metadata: {
      ...REPORT_ANSWER_BASE.msg.metadata,
      threadKey: "q-2042",
      threadAnswer: { version: 2 as const, answerUserMessageIds: [], observedHistoryLength: 2, ownerGroups: [] },
    },
  },
};
const REPORT_ANSWER_TURN: Turn = {
  ...ANSWER_ONLY_TURN,
  id: "playground-report-answer-turn",
  userEntry: null,
  allEntries: [PUBLISHED_REPORT, REPORT_ANSWER],
  presentationEntries: [PUBLISHED_REPORT, REPORT_ANSWER],
  notificationEntries: [PUBLISHED_REPORT, REPORT_ANSWER],
  responseEntry: null,
};
const REPORT_ANSWER_PRESENTATION: ThreadResponsePresentation = {
  ...ACTIVE_PRESENTATION,
  currentResponses: [
    {
      response: {
        ...PRESENTATION.currentResponses[0]!.response,
        answerUserMessageIds: [],
        referencedUserMessageIds: [],
        coveredAnswerUserMessageIds: [],
        coveredUserMessageIds: [],
        currentMessageId: REPORT_ANSWER.msg.id,
        currentHistoryIndex: REPORT_ANSWER.msg.historyIndex,
      },
      sourceTurnId: REPORT_ANSWER_TURN.id,
      messageEntry: REPORT_ANSWER,
      collapsedMessageEntry: REPORT_ANSWER,
      referencedUserMessages: [],
    },
  ],
  currentResponseMessageIds: new Set([REPORT_ANSWER.msg.id]),
  quizGroups: [],
  layoutSignature: "playground-report-answer",
};

const EXPANDED_ENTRIES: FeedEntry[] = [
  assistantEntry("playground-response-old", "Earlier answer wording for the same requests.", "answer"),
  INTERMEDIATE,
  CURRENT_RESPONSE,
];
const EXPANDED_TURN: Turn = { ...READY_TURN, allEntries: EXPANDED_ENTRIES, presentationEntries: EXPANDED_ENTRIES };
const HANDOFF_NOTE = assistantEntry(
  "playground-handoff-note",
  "You're right, that's a bug in the thread link q-2042 just delivered. I've reopened that quest, and I'll follow the fix there.",
  "commentary",
);
// The request was handed off to a quest, so this turn has no answer of its own.
const HANDOFF_TURN: Turn = {
  ...READY_TURN,
  id: "playground-user-handed-off",
  allEntries: [HANDOFF_NOTE],
  presentationEntries: [HANDOFF_NOTE],
  agentEntries: [HANDOFF_NOTE],
  notificationEntries: [],
  lastMessageEntry: HANDOFF_NOTE,
  stats: { messageCount: 1, toolCount: 2, subagentCount: 0, herdEventCount: 0 },
};

const NOOP = () => {};

function renderEntry(entry: FeedEntry) {
  return (
    <FeedEntries
      entries={[entry]}
      sessionId={SESSION_ID}
      currentThreadKey="q-2042"
      isCodexSession={false}
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={NOOP}
      onSelectThread={NOOP}
      questLinkSurface="chat-feed"
    />
  );
}

export function PlaygroundThreadResponseSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <PlaygroundChronologicalAnswers />
      <PlaygroundQuestDescriptionSummary />
      <PlaygroundQuestCompletionSummary />
      <Section
        title="Routed Answers"
        description="Every valid routed answer remains visible in source chronology with its original coverage preview; later answers add or correct substance, Ready controls whole-thread collapse, and expanded history preserves all commentary and answer rows."
      >
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Card label="Collapsed Ready · chronological answer set plus Quiz">
            <div
              className="min-w-0 max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-turn-summary-with-tools"
            >
              <TurnActivityDisclosure stats={READY_TURN.stats} durationMs={null} expanded={false} onToggle={NOOP} />
              <ReadyThreadResponseRows
                turn={READY_TURN}
                presentation={PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="Collapsed answer only · answers the message above">
            <div
              className="min-w-0 w-full max-w-[320px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-turn-summary-without-tools"
            >
              <TurnActivityDisclosure
                stats={ANSWER_ONLY_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={ANSWER_ONLY_TURN}
                presentation={ANSWER_ONLY_PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="Collapsed answer · comment-only request preview">
            <div
              className="min-w-0 w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-comment-only-answer"
            >
              <TurnActivityDisclosure
                stats={COMMENT_ONLY_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={COMMENT_ONLY_TURN}
                presentation={COMMENT_ONLY_PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="Collapsed Ready · handed off, no answer · last message">
            <div
              className="min-w-0 w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-unanswered-handoff-turn"
            >
              <TurnActivityDisclosure stats={HANDOFF_TURN.stats} durationMs={null} expanded={false} onToggle={NOOP} />
              <ReadyThreadResponseRows
                turn={HANDOFF_TURN}
                presentation={ANSWER_ONLY_PRESENTATION}
                unansweredMessageEntry={HANDOFF_NOTE}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="main"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="Collapsed answer from another thread · thread link above the quote">
            <div
              className="min-w-0 w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-cross-thread-answer"
            >
              <TurnActivityDisclosure
                stats={CROSS_THREAD_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={CROSS_THREAD_TURN}
                presentation={CROSS_THREAD_PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="Collapsed decision · one source Quiz">
            <div
              className="min-w-0 w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-pinned-quiz-source"
            >
              <TurnActivityDisclosure
                stats={QUIZ_PROMPT_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={QUIZ_PROMPT_TURN}
                presentation={ACTIVE_PRESENTATION}
                needsInputAnchorMessageIds={new Set([QUIZ_PROMPT.msg.id])}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <PlaygroundCollapsedAnsweredDecision />
          <PlaygroundAnswersApart />
          <Card label="Collapsed quest projection · associated Main answer">
            <div
              className="min-w-0 w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-associated-main-answer"
            >
              <TurnActivityDisclosure
                stats={ASSOCIATED_MAIN_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={ASSOCIATED_MAIN_TURN}
                presentation={ASSOCIATED_MAIN_PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="Expanded active thread · complete chronology">
            <div
              className="min-w-0 max-w-[430px] space-y-3 rounded-xl border border-cc-border/30 bg-cc-card/20 p-3"
              data-testid="playground-turn-summary-expanded"
            >
              <TurnActivityDisclosure stats={READY_TURN.stats} durationMs={null} expanded onToggle={NOOP} />
              <TurnEntriesExpanded
                turn={EXPANDED_TURN}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                isCodexSession={false}
                activeCodexTerminalIds={new Set()}
                onOpenCodexTerminal={NOOP}
                questLinkSurface="chat-feed"
                threadResponsePresentation={ACTIVE_PRESENTATION}
              />
            </div>
          </Card>
          <Card label="Collapsed answer nobody asked for · published report above it">
            <div
              className="min-w-0 w-full max-w-[430px] rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-report-answer"
            >
              <TurnActivityDisclosure
                stats={REPORT_ANSWER_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={REPORT_ANSWER_TURN}
                presentation={REPORT_ANSWER_PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
          <Card label="One answer · Main and quest requests">
            <div
              className="min-w-0 w-full max-w-[430px] rounded-xl border border-cc-border/30 bg-cc-card/20"
              data-testid="playground-multi-owner-answer"
            >
              <TurnActivityDisclosure
                stats={MULTI_OWNER_TURN.stats}
                durationMs={null}
                expanded={false}
                onToggle={NOOP}
              />
              <ReadyThreadResponseRows
                turn={MULTI_OWNER_TURN}
                presentation={MULTI_OWNER_PRESENTATION}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                onSelectThread={NOOP}
                questLinkSurface="chat-feed"
              />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
