/**
 * Phone thread tabs as status groups: the bar with its chips, each chip's list, and Find
 * with its two modes (the user's messages, or open and closed tabs, both newest first),
 * at the top and at the bottom of the screen.
 */
import { useState } from "react";
import { getQuestJourneyPhase } from "../../../shared/quest-journey.js";
import { getQuestPhaseAccentValue, getQuestPhaseThreadTabTitleColorValue } from "../../utils/quest-phase-theme.js";
import type { TopicSummary } from "../../../shared/library-topics.js";
import { ThreadTabGroupBar } from "../ThreadTabGroups.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.now();
const MINUTE = 60_000;

function questTab(
  questId: string,
  title: string,
  phaseId: string | null,
  overrides: Partial<PrimaryThreadChip> = {},
): PrimaryThreadChip {
  const phase = phaseId ? getQuestJourneyPhase(phaseId) : null;
  return {
    threadKey: questId,
    questId,
    title,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: !phase,
    completed: !phase,
    titleColor: phase ? getQuestPhaseThreadTabTitleColorValue(phase.color) : "var(--color-cc-muted)",
    accentColor: phase ? getQuestPhaseAccentValue(phase.color) : "var(--color-cc-muted)",
    stateLabel: phase?.label ?? "Done",
    updatedAt: NOW - 5 * MINUTE,
    ...overrides,
  };
}

const MAIN: PrimaryThreadChip = {
  threadKey: "main",
  title: "Main Thread",
  needsInput: false,
  mutedNeedsInput: false,
  blueNudge: true,
  canClose: false,
  updatedAt: NOW,
};

const TABS: PrimaryThreadChip[] = [
  questTab("q-9482", "Redesign thread tabs around what the user scans", "work"),
  questTab("q-9481", "Thumb-reachable mobile layout for top-bar actions", "user-checkpoint", { needsInput: true }),
  // A side quest: its answer is given in q-9482, so the lists mark it with the branch icon.
  questTab("q-9480", "Keep the screen awake while recording voice", "memory", { sideQuestOf: "q-9482" }),
  questTab("q-9476", "Fix login-shell PATH capture on remote hosts", "landing"),
  questTab("q-9479", "Walk the paw down the feed as answers arrive", null, { blueNudge: true }),
  ...["Attribute a dismissed question to the leader", "Board dots contrast in light theme", "Sync unsent drafts"].map(
    (title, index) =>
      questTab(`q-${9470 - index}`, title, null, {
        updatedAt: NOW - (index + 2) * 60 * MINUTE,
        ...(index === 1 ? { sideQuestOf: "main" } : {}),
      }),
  ),
];

/** A long-running leader's past quests: Find's Tabs mode lists them with the open tabs, by recency. */
/** For a leader with topics on: its topics by recent activity, for the Topics group. */
const TOPICS: TopicSummary[] = [
  playgroundTopic("topic-feed", "Feed polish", 12, "Answer times sit on the last line of each answer.", 1),
  playgroundTopic("topic-light", "Light theme", 95, "Quest strips use the card color in light mode."),
  playgroundTopic("topic-voice", "Voice input", 60 * 26, "Dictation keeps recording through a phone call."),
];

function playgroundTopic(id: string, name: string, minutesAgo: number, update: string, waiting = 0): TopicSummary {
  const at = NOW - minutesAgo * MINUTE;
  return {
    id,
    space: "Takode",
    name,
    nameSource: "agent",
    tentative: false,
    createdAt: at,
    updatedAt: at,
    questIds: ["q-9479", "q-9470"],
    summary: "",
    upToDateAt: at,
    pendingEvents: 0,
    activityAt: at,
    latestUpdate: update,
    waitingOnYou: Array.from({ length: waiting }, () => "Pick a layout."),
    openNow: waiting,
  };
}

function PhoneFrame({ placement, topics = false }: { placement: "top" | "bottom"; topics?: boolean }) {
  const [current, setCurrent] = useState("q-9482");
  // The topic whose conversation is on screen: the Topics group stays selected while it is.
  const [topicOpen, setTopicOpen] = useState<string | null>(null);
  const [tabs, setTabs] = useState(TABS);
  const select = (threadKey: string) => {
    setCurrent(threadKey);
    setTopicOpen(null);
  };
  const close = (threadKey: string) => {
    setTabs((existing) => existing.filter((tab) => tab.threadKey !== threadKey));
  };
  return (
    <div
      className="w-[430px] max-w-full rounded-lg border border-cc-border bg-cc-card px-3"
      data-testid="playground-thread-tab-groups"
    >
      <ThreadTabGroupBar
        main={MAIN}
        tabs={tabs}
        placement={placement}
        currentThreadKey={current}
        activeOutputThreadKey="q-9482"
        threadStatuses={{
          "q-9479": {
            kind: "ready",
            label: "Thread Ready",
            threadKey: "q-9479",
            questId: "q-9479",
            summary: "landed; watch a live answer on the phone",
            messageId: "ready-9479",
            timestamp: NOW,
            updatedAt: NOW,
          },
        }}
        onSelect={select}
        onClose={close}
        topicsGroup={
          topics ? { topics: TOPICS, currentTopicId: topicOpen, onOpen: (topic) => setTopicOpen(topic.id) } : undefined
        }
      />
    </div>
  );
}

export function PlaygroundThreadTabGroupsSection() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Thread Tab Groups"
        description="Leader thread tabs on every screen size: Main, one item per kind of tab (prompts waiting, in progress with phase-color dots, unread results, done), and a Topics group after Main when topics are on; wide screens add each group's name. The quest strip names the current quest, so the bar only marks the group that holds it. A group lists its tabs (a group of one opens its tab directly; long-press shows the list); the Done list offers Close all. Finding a tab (open or closed) or a message is Search everything's Tabs and Messages modes. For a leader with Library topics on, a Topics group right after Main lists its topics by recent activity, each with its newest update; tapping one reads it as one conversation, and the group stays selected, with that topic marked, while it is on screen."
      >
        <div className="space-y-4">
          <Card label="At the top (tap a group)">
            <PhoneFrame placement="top" />
          </Card>
          <Card label="Topics on (open Topics, pick one)">
            <PhoneFrame placement="top" topics />
          </Card>
          <Card label="At the bottom (lists open upward)">
            <div className="pt-72">
              <PhoneFrame placement="bottom" />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
