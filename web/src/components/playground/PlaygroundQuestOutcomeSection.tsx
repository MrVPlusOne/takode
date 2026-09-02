import type { QuestOutcomeState } from "../../types.js";
import { QuestOutcomeCard } from "../QuestOutcomeCard.js";
import { Card, Section } from "./shared.js";

const ACTIVE_OUTCOME: QuestOutcomeState = {
  currentRevisionId: "playground-r2",
  revisions: [
    {
      revisionId: "playground-r1",
      markdown: "## Diagnosis\n\nThe first useful explanation remains available in version history.",
      summaryMarkdown: "The first useful explanation remains available.",
      summarySource: "derived",
      contentHash: "playground-h1",
      createdAt: 1_788_370_000_000,
      actor: { kind: "leader", sessionId: "playground-leader", sessionNum: 7 },
      anchor: { sessionId: "playground-leader", historyIndex: 4, messageId: "playground-a1" },
      sources: [],
    },
    {
      revisionId: "playground-r2",
      parentRevisionId: "playground-r1",
      markdown:
        "## Current result\n\nTakode shows one **moving Outcome card** after the activity it summarizes. Later work remains visible below it, while superseded prose stays under Versions.\n\n- Exact routed messages can seed the document.\n- Direct edits do not rewrite chat history.\n- Routine progress does not require a revision.",
      summaryMarkdown: "One moving Outcome card keeps the latest useful result prominent without rewriting history.",
      summarySource: "authored",
      contentHash: "playground-h2",
      createdAt: 1_788_372_000_000,
      actor: { kind: "human" },
      anchor: { sessionId: "playground-leader", historyIndex: 9, messageId: "playground-a2" },
      sources: [],
    },
  ],
};

export function PlaygroundQuestOutcomeSection() {
  return (
    <Section
      title="Quest Outcome"
      description="One current version moves through the owning quest feed while prior revisions, chronological history, and Quiz remain separately inspectable."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Card label="Active quest · newer activity below">
          <QuestOutcomeCard
            questId="q-2042"
            questTitle="Build editable quest outcomes"
            questStatus="in_progress"
            outcome={ACTIVE_OUTCOME}
            sessionId="playground-leader"
            newerActivityBelow
            showQuiz={false}
          />
        </Card>
        <Card label="Completed quest · Outcome plus Quiz">
          <div className="max-w-[420px]">
            <QuestOutcomeCard
              questId="q-2042"
              questTitle="Build editable quest outcomes"
              questStatus="done"
              outcome={ACTIVE_OUTCOME}
              sessionId="playground-leader"
              newerActivityBelow={false}
              showQuiz
              quizItems={[
                {
                  id: "playground-outcome-quiz",
                  question: "What remains authoritative after the Outcome moves?",
                  answer:
                    "The original chat history, routing, Journey/status state, prior Outcome versions, and Quest Quiz.",
                },
              ]}
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
