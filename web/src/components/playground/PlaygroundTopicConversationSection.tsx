import { useEffect } from "react";
import type { QuestmasterTask } from "../../types.js";
import { useStore } from "../../store.js";
import { TopicConversationHeader } from "../library/TopicConversation.js";
import { TopicFeedQuestStart } from "../topic-feed.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const QUESTS = [
  { questId: "q-9601", title: "Guided review: Takode links and file lists in summaries" },
  { questId: "q-9602", title: "Walkthrough: closer Back/Next, drop redundant answer choices" },
];

/**
 * A topic conversation: the topic header in place of the quest strip, and each quest's strip in
 * the feed where its part starts, sticking to the top while that part is read.
 */
export function PlaygroundTopicConversationSection() {
  useEffect(() => {
    const now = Date.now();
    useStore.setState((state) => {
      const details = new Map(state.questDetails);
      for (const quest of QUESTS) {
        details.set(quest.questId, {
          id: `${quest.questId}-v1`,
          version: 1,
          createdAt: now,
          updatedAt: now,
          status: "done",
          description: "",
          ...quest,
        } as unknown as QuestmasterTask);
      }
      return { questDetails: details };
    });
  }, []);
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Topic Conversation"
        description="A topic's quests read as one conversation, opened from a quest's Whole topic button or a topic row in the Done list. The topic header replaces the quest strip (× goes back to the quest alone); each quest's strip sits in the feed where its part starts and sticks to the top while you read it, until the next one covers it. Tapping a strip opens that quest's own tab."
      >
        <Card label="Scroll inside the box">
          <div className="max-w-md overflow-hidden rounded-lg border border-cc-border">
            <TopicConversationHeader
              leaderId="playground-leader"
              topic={{ topicId: "t", name: "Guided review and diffs", questIds: QUESTS.map((quest) => quest.questId) }}
              onClose={() => {}}
            />
            <div className="h-72 overflow-y-auto px-3">
              {QUESTS.map((quest) => (
                <div key={quest.questId} className="contents">
                  <TopicFeedQuestStart questId={quest.questId} />
                  {Array.from({ length: 6 }, (_, index) => (
                    <p key={index} className="py-2 text-sm text-cc-fg">
                      A message about {quest.title.toLowerCase()} ({index + 1}).
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Section>
    </PlaygroundSectionGroup>
  );
}
