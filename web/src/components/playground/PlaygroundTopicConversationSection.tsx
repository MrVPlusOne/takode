import { TopicLabelButton } from "../MessageTopicLabel.js";
import { useEffect, useState } from "react";
import type { Turn } from "../../hooks/use-feed-model.js";
import type { QuestmasterTask } from "../../types.js";
import { useStore } from "../../store.js";
import { TopicEntryContext, TopicFeedEntry } from "../library/TopicConversation.js";
import { TopicFeedContext, TopicFeedQuestStart } from "../topic-feed.js";
import { MainQuestStrip } from "../MainQuestStrip.js";
import { TopicProgressCard, type ProgressRun } from "../topic-progress-card.js";
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
        <Card label="Zooming out from a quest tab: the line its conversation opens with">
          <div className="max-w-md overflow-hidden rounded-lg border border-cc-border">
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
        <Card label="Main: a strip above each request that went to a quest, and Main where Main's own talk resumes (a day divider always comes before a strip)">
          <div className="h-56 max-w-md overflow-y-auto rounded-lg border border-cc-border px-3">
            <MainQuestStrip
              sessionId="playground-leader"
              quest={{
                questId: QUESTS[0]!.questId,
                title: QUESTS[0]!.title,
                sideQuest: false,
                startedFrom: { sessionId: "playground-leader", messageId: "m1", threadKey: "main", timestamp: 1 },
              }}
            />
            {Array.from({ length: 4 }, (_, index) => (
              <p key={index} className="py-2 text-sm text-cc-fg">
                Conversation about the guided review ({index + 1}).
              </p>
            ))}
            <MainQuestStrip sessionId="playground-leader" quest={null} />
            {Array.from({ length: 4 }, (_, index) => (
              <p key={index} className="py-2 text-sm text-cc-fg">
                Back to Main ({index + 1}).
              </p>
            ))}
          </div>
        </Card>
        <Card label="Quests running together: their interleaved progress folds into one card, each quest's latest updates rolling (Show all brings its turns back into the conversation)">
          <div className="max-w-xl">
            <PlaygroundProgressCard />
          </div>
        </Card>
        <Card label="Scroll inside the box">
          <div className="max-w-md overflow-hidden rounded-lg border border-cc-border">
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

const PROGRESS_UPDATES: Array<[questId: string, text: string]> = [
  ["q-9601", "The review map is drafted; links in summaries now open the quest."],
  ["q-9602", "Back and Next sit closer to the answer; checking the phone layout."],
  ["q-9601", "File lists render as **links**, one per line."],
  ["q-9602", "Redundant answer choices are gone from walkthrough questions."],
  ["q-9601", "Waiting for the reviewer to finish the second pass."],
  ["q-9601", "Reviewer found one stale link; fixing it now."],
  ["q-9602", "Phone layout checked in dark and light."],
  ["q-9601", "Stale link fixed, the review is ready."],
];

/** A progress run of the two quests, as the feed builds it from their turns. */
function PlaygroundProgressCard() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const start = Date.now() - PROGRESS_UPDATES.length * 4 * 60_000;
  const turns = PROGRESS_UPDATES.map(
    ([, text], index) =>
      ({
        id: `progress-${index}`,
        userEntry: null,
        allEntries: [
          {
            kind: "message",
            msg: { id: `progress-msg-${index}`, role: "assistant", content: text, timestamp: start + index * 240_000 },
          },
        ],
      }) as unknown as Turn,
  );
  const run: ProgressRun = {
    key: "progress-0",
    groups: QUESTS.map((quest) => ({
      quest: quest.questId,
      turnIndexes: PROGRESS_UPDATES.flatMap(([questId], index) => (questId === quest.questId ? [index] : [])),
    })),
  };
  return (
    <TopicProgressCard
      run={run}
      turns={turns}
      topicKey="topic:aaaaaaaa"
      openQuests={open}
      onToggle={(quest) =>
        setOpen((previous) => {
          const next = new Set(previous);
          if (next.has(quest)) next.delete(quest);
          else next.add(quest);
          return next;
        })
      }
    />
  );
}
