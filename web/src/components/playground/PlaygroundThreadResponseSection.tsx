import type { FeedEntry, Turn } from "../../hooks/use-feed-model.js";
import type { ThreadResponsePresentation } from "../thread-response-presentation.js";
import { FeedEntries } from "../MessageFeedEntries.js";
import { ReadyThreadResponseRows } from "../ReadyThreadResponseRows.js";
import { TurnToggleFooter } from "../CollapseFooter.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

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

const CURRENT_RESPONSE = assistantEntry(
  "playground-response-current",
  "The responsive feed now foregrounds one polished response for this two-message batch. Earlier working notes and tools remain available when the turn is expanded.",
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
  allEntries: [INTERMEDIATE, CURRENT_RESPONSE],
  presentationEntries: [INTERMEDIATE, CURRENT_RESPONSE],
  agentEntries: [INTERMEDIATE],
  systemEntries: [],
  notificationEntries: [CURRENT_RESPONSE],
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
        coveredAnswerUserMessageIds: ["u1", "u2"],
        coveredUserMessageIds: ["playground-user-first", "playground-user-second"],
        currentMessageId: CURRENT_RESPONSE.msg.id,
        currentHistoryIndex: 7,
        createdAt: 7,
        updatedAt: 7,
        source: "explicit",
      },
      anchorUserMessageId: "playground-user-second",
      anchorTurnId: READY_TURN.id,
      anchorOrder: 1,
      sourceTurnId: READY_TURN.id,
      messageEntry: CURRENT_RESPONSE,
      collapsedMessageEntry: CURRENT_RESPONSE,
    },
  ],
  currentResponseMessageIds: new Set([CURRENT_RESPONSE.msg.id]),
  quizGroups: [{ hostTurnId: READY_TURN.id, questIds: ["q-8"] }],
  layoutSignature: "playground-response-r2",
};
const ACTIVE_PRESENTATION: ThreadResponsePresentation = {
  ...PRESENTATION,
  ready: false,
  pendingMessageCount: 1,
  layoutSignature: "playground-response-r2-pending",
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
      questLinkSurface="chat-feed"
    />
  );
}

export function PlaygroundThreadResponseSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Routed Answers"
        description="Current routed answers stay visible even while other work remains pending; Ready still controls automatic whole-thread collapse, and expanded history preserves commentary plus superseded answers."
      >
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Card label="Collapsed Ready · grouped answer plus Quiz">
            <div className="min-w-0 max-w-[430px] overflow-hidden rounded-xl border border-cc-border/30 bg-cc-card/20">
              <ReadyThreadResponseRows
                turn={READY_TURN}
                presentation={PRESENTATION}
                durationMs={42_000}
                onExpand={NOOP}
                renderEntry={renderEntry}
                sessionId={SESSION_ID}
                questLinkSurface="chat-feed"
              />
              <TurnToggleFooter expanded={false} onToggle={NOOP} />
            </div>
          </Card>
          <Card label="Expanded active thread · complete chronology">
            <div className="min-w-0 max-w-[430px] space-y-3 rounded-xl border border-cc-border/30 bg-cc-card/20 p-3">
              <FeedEntries
                entries={[
                  assistantEntry("playground-response-old", "Earlier answer wording for the same requests.", "answer"),
                  INTERMEDIATE,
                  CURRENT_RESPONSE,
                ]}
                sessionId={SESSION_ID}
                currentThreadKey="q-2042"
                isCodexSession={false}
                activeCodexTerminalIds={new Set()}
                onOpenCodexTerminal={NOOP}
                questLinkSurface="chat-feed"
                threadResponsePresentation={ACTIVE_PRESENTATION}
              />
              <TurnToggleFooter expanded onToggle={NOOP} />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
