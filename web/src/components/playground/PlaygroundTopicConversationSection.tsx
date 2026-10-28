import { TopicLabelButton } from "../MessageTopicLabel.js";
import { useEffect } from "react";
import type { QuestmasterTask } from "../../types.js";
import { useStore } from "../../store.js";
import {
  TopicConversationHeader,
  TopicEntryContext,
  TopicEntryLine,
  TopicFeedEntry,
} from "../library/TopicConversation.js";
import { TopicFeedContext, TopicFeedQuestStart } from "../topic-feed.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const QUESTS = [
  { questId: "q-9601", title: "Guided review: Takode links and file lists in summaries" },
  { questId: "q-9602", title: "Walkthrough: closer Back/Next, drop redundant answer choices" },
];

/**
 * A topic conversation: the topic header in place of the quest strip, and a strip in the feed
 * where each part starts (the topic's own thread, and each quest), sticking to the top while that
 * part is read.
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
        description="A quest tab is the quest zoomed in from its topic. The topic line above the quest's strip (‹ topic name) zooms out to the topic's quests read as one conversation, at this quest's place; so do the Part of line at the start of the quest's conversation, View topic tab on the topic page and the Topics tab group. The topic header replaces the quest strip; each quest's strip sits in the feed where its part starts and sticks to the top while you read it, until the next one covers it. Tapping a strip zooms into that quest; back zooms out again."
      >
        <Card label="Zooming out from a quest tab: the topic line above its strip, and the line its conversation opens with">
          <div className="max-w-md overflow-hidden rounded-lg border border-cc-border">
            <TopicEntryLine name="Guided review and diffs" count={QUESTS.length} onOpen={() => {}} />
            <div className="px-3 py-3">
              <TopicEntryContext.Provider
                value={{ name: "Guided review and diffs", count: QUESTS.length, onOpen: () => {} }}
              >
                <TopicFeedEntry />
              </TopicEntryContext.Provider>
            </div>
          </div>
        </Card>
        <Card label="A user's message shown where it doesn't belong (here, Main after a handoff) names its topic; tapping opens the topic at the message">
          <div className="flex max-w-md justify-end">
            <div className="rounded-[14px] rounded-br-[4px] bg-cc-user-bubble px-4 py-2.5 text-sm text-cc-fg">
              <TopicLabelButton
                name="Guided review and diffs"
                title="In the topic Guided review and diffs"
                onClick={() => {}}
              />
              Could the diff header stay on screen while I scroll?
            </div>
          </div>
        </Card>
        <Card label="Scroll inside the box">
          <div className="max-w-md overflow-hidden rounded-lg border border-cc-border">
            <TopicConversationHeader
              leaderId="playground-leader"
              topic={{ topicId: "t", name: "Guided review and diffs", questIds: QUESTS.map((quest) => quest.questId) }}
            />
            {/* The topic's own thread (what was written in the conversation itself) has a strip too. */}
            <TopicFeedContext.Provider
              value={{
                questIds: QUESTS.map((quest) => quest.questId),
                topicKey: "topic:aaaaaaaa",
                topicName: "Guided review and diffs",
                openQuest: () => {},
              }}
            >
              <div className="h-72 overflow-y-auto px-3">
                {[{ questId: "topic:aaaaaaaa", title: "The topic as a whole" }, ...QUESTS].map((quest) => (
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
            </TopicFeedContext.Provider>
          </div>
        </Card>
      </Section>
    </PlaygroundSectionGroup>
  );
}
