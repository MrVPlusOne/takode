import { TopicLabelButton } from "../MessageTopicLabel.js";
import { useEffect } from "react";
import type { Turn } from "../../hooks/use-feed-model.js";
import type { QuestmasterTask } from "../../types.js";
import { useStore } from "../../store.js";
import { TopicEntryContext, TopicFeedEntry } from "../library/TopicConversation.js";
import { TopicFeedContext, TopicFeedQuestStart } from "../topic-feed.js";
import { MainQuestStrip } from "../MainQuestStrip.js";
import { TopicFeedTurns } from "../topic-feed-turns.js";
import { rememberTopicViewMembers } from "../../utils/thread-projection.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const QUESTS = [
  { questId: "q-9601", title: "Guided review: Takode links and file lists in summaries" },
  { questId: "q-9602", title: "Walkthrough: closer Back/Next, drop redundant answer choices" },
];

// The topic's quests are its own: their messages get no thread label, as in the app.
rememberTopicViewMembers(
  "topic:aaaaaaaa",
  QUESTS.map((quest) => quest.questId),
);

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
        <Card label="Quests running together, one at a time: each request is followed by its answers, follow-up included, and the next quest's track starts where its request was; working steps stay in the quests' threads">
          <div className="max-w-xl">
            <PlaygroundParallelTracks />
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

/** What happened in the topic, in time order: two quests' requests and answers interleaving. */
const PARALLEL_MESSAGES: Array<[questId: string, role: "user" | "assistant", text: string]> = [
  ["q-9601", "user", "Make the links in the review summary open the quest."],
  ["q-9602", "user", "Back and Next are too far apart in walkthroughs."],
  ["q-9601", "assistant", "Links in summaries now open the quest, and file lists show one link per line."],
  ["q-9602", "assistant", "Back and Next now sit next to the answer, and the redundant choices are gone."],
  ["q-9601", "user", "Can the stale link in the second section go too?"],
  ["q-9601", "assistant", "The stale link is fixed; the review is ready."],
];

/** The topic conversation of two quests running together, as the feed shows it. */
function PlaygroundParallelTracks() {
  const start = Date.now() - PARALLEL_MESSAGES.length * 10 * 60_000;
  const turns = PARALLEL_MESSAGES.map(([questId, role, content], index) => {
    const msg = {
      id: `parallel-${index}`,
      role,
      content,
      timestamp: start + index * 600_000,
      metadata:
        role === "user"
          ? { leaderResponseCoverageVersion: 1, threadKey: questId, questId }
          : { leaderThreadRole: "answer", threadKey: questId, questId },
    };
    const entry = { kind: "message", msg };
    return {
      id: `parallel-turn-${index}`,
      userEntry: role === "user" ? entry : null,
      allEntries: role === "user" ? [] : [entry],
    } as unknown as Turn;
  });
  return (
    <TopicFeedContext.Provider
      value={{
        questIds: QUESTS.map((quest) => quest.questId),
        topicKey: "topic:aaaaaaaa",
        topicName: "Guided review and diffs",
        openQuest: () => {},
      }}
    >
      <div className="space-y-3">
        <TopicFeedTurns
          turns={turns}
          turnQuests={PARALLEL_MESSAGES.map(([questId]) => questId)}
          topicKey="topic:aaaaaaaa"
          sectionStartTurnIds={new Set()}
          sessionId="playground-leader"
          currentThreadKey="topic:aaaaaaaa"
          isCodexSession={false}
          activeCodexTerminalIds={new Set()}
          onOpenCodexTerminal={() => {}}
          questLinkSurface="chat-feed"
          presentationOf={() => null}
        />
      </div>
    </TopicFeedContext.Provider>
  );
}
