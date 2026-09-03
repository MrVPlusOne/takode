import type { FeedEntry, Turn } from "../../hooks/use-feed-model.js";
import type { ThreadResponsePresentation } from "../thread-response-presentation.js";
import { FeedEntries } from "../MessageFeedEntries.js";
import { ReadyThreadResponseRows } from "../ReadyThreadResponseRows.js";
import { Card, Section } from "./shared.js";

const SESSION_ID = "playground-thread-responses";

function assistantEntry(id: string, content: string): Extract<FeedEntry, { kind: "message" }> {
  return { kind: "message", msg: { id, role: "assistant", content, timestamp: 1 } };
}

const CURRENT_RESPONSE = assistantEntry(
  "playground-response-current",
  "The responsive feed now foregrounds one polished response for this two-message batch. Earlier working notes and tools remain available when the turn is expanded.",
);
const INTERMEDIATE = assistantEntry(
  "playground-response-intermediate",
  "Intermediate investigation detail that belongs only in expanded chronology.",
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
        version: 1,
        logicalResponseId: "playground-logical-response",
        threadKey: "q-2042",
        questId: "q-2042",
        batchId: "playground-batch",
        batchObservedHistoryLength: 8,
        coveredUserMessageIds: ["playground-user-first", "playground-user-second"],
        currentRevisionId: "playground-r2",
        currentMessageId: CURRENT_RESPONSE.msg.id,
        currentHistoryIndex: 7,
        revisionCount: 2,
        createdAt: 6,
        updatedAt: 7,
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
  quizQuestIds: ["q-8"],
  quizHostTurnId: READY_TURN.id,
  layoutSignature: "playground-response-r2",
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
    <Section
      title="Thread Responses"
      description="Ready threads show the current response for each server-defined pending batch, while expanded chronology preserves revisions and intermediate work."
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card label="Collapsed Ready · grouped response plus Quiz">
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
          </div>
        </Card>
        <Card label="Expanded chronology · revisions and working activity">
          <div className="min-w-0 max-w-[430px] space-y-3 rounded-xl border border-cc-border/30 bg-cc-card/20 p-3">
            <FeedEntries
              entries={[
                assistantEntry("playground-response-old", "Earlier wording for the same response batch."),
                INTERMEDIATE,
                CURRENT_RESPONSE,
              ]}
              sessionId={SESSION_ID}
              currentThreadKey="q-2042"
              isCodexSession={false}
              activeCodexTerminalIds={new Set()}
              onOpenCodexTerminal={NOOP}
              questLinkSurface="chat-feed"
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
