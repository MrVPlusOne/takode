/**
 * Phone thread tabs as status groups: the bar with its chips, each chip's list, and Find
 * with its two modes (the user's messages, or open and closed tabs, both newest first),
 * at the top and at the bottom of the screen.
 */
import { QuestThreadBanner } from "../QuestThreadBanner.js";
import { TopicCrumb } from "../library/TopicConversation.js";
import { useState } from "react";
import { getQuestJourneyPhase } from "../../../shared/quest-journey.js";
import { getQuestPhaseAccentValue, getQuestPhaseThreadTabTitleColorValue } from "../../utils/quest-phase-theme.js";
import type { ThreadSummary, TopicSummary } from "../../../shared/library-topics.js";
import { NewThreadBody, NewThreadHeader, ThreadHeader } from "../NewThreadPage.js";
import type { ThreadsMenu } from "../ThreadsMenu.js";
import type { SessionAttentionPreview } from "../../hooks/useSessionAttention.js";
import { NotificationChip } from "../NotificationChip.js";
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

/** For a leader with topics on: its topics by recent activity, for the Topics group. */
const TOPICS: TopicSummary[] = [
  playgroundTopic("topic-feed", "Feed polish", 12, "Answer times sit on the last line of each answer.", [
    "q-9482",
    "q-9479",
    "q-9470",
  ]),
  playgroundTopic("topic-light", "Light theme", 95, "Quest strips use the card color in light mode.", [
    "q-9476",
    "q-9469",
  ]),
  playgroundTopic("topic-voice", "Voice input", 60 * 26, "Dictation keeps recording through a phone call.", ["q-9480"]),
];

/** Each tab's topic; q-9481 and q-9468 are in none yet, so they show under "Not in a topic". */
const TOPIC_OF_QUEST = Object.fromEntries(
  TOPICS.flatMap((topic) => topic.questIds.map((questId) => [questId, topic.id])),
);

function playgroundTopic(
  id: string,
  name: string,
  minutesAgo: number,
  update: string,
  questIds: string[],
): TopicSummary {
  const at = NOW - minutesAgo * MINUTE;
  return {
    id,
    space: "Takode",
    name,
    nameSource: "agent",
    tentative: false,
    createdAt: at,
    updatedAt: at,
    questIds,
    summary: "",
    upToDateAt: at,
    pendingEvents: 0,
    activityAt: at,
    latestUpdate: update,
    openNow: 0,
  };
}

/**
 * A leader's threads (New thread) for the Threads menu: one the leader is answering, one with an
 * unread answer, one with an open question and one whose first message never arrived (all Active),
 * then two read ones (Recent), one unfiled and one filed under a topic.
 */
const THREADS: ThreadSummary[] = [
  playgroundThread("0a1b2c3d", "Phone can't reach Takode over Tailscale", 1),
  playgroundThread("1b2c3d4e", "Rocq vs Lean as a proof RL environment", 6),
  playgroundThread("4e5f6a7b", "Name for the daily summary", 12, {
    settledAt: NOW - 10 * MINUTE,
    topic: { id: "topic-briefing", name: "Daily briefing" },
  }),
  playgroundThread("5f6a7b8c", "Quick question about the landing queue", 20, { empty: true }),
  playgroundThread("2c3d4e5f", "Why the old draft came back", 50, { settledAt: NOW - 40 * MINUTE }),
  playgroundThread("3d4e5f6a", "Answer times on wrapped lines", 90, {
    settledAt: NOW - 80 * MINUTE,
    topic: { id: "topic-feed", name: "Feed polish" },
  }),
];
const THREAD_UNREAD: Record<string, number> = { "topic:1b2c3d4e": 1 };
const THREAD_QUESTIONS: Record<string, number> = { "topic:4e5f6a7b": 1 };
const WRITING_THREAD = "topic:0a1b2c3d";

function playgroundThread(
  handle: string,
  name: string,
  minutesAgo: number,
  overrides: Partial<ThreadSummary> = {},
): ThreadSummary {
  const at = NOW - minutesAgo * MINUTE;
  return {
    id: handle,
    key: `topic:${handle}`,
    name,
    leaderId: "playground",
    createdAt: at,
    activityAt: at,
    ...overrides,
  };
}

function threadsMenu(onOpen: (threadKey: string) => void): ThreadsMenu {
  return {
    threads: THREADS,
    starting: false,
    onStart: () => {},
    onOpen,
    unread: (threadKey) => THREAD_UNREAD[threadKey] ?? 0,
    questions: (threadKey) => THREAD_QUESTIONS[threadKey] ?? 0,
    onRemove: () => {},
  };
}

/** Two unread results for the desktop chip after the tabs. */
const TAB_ROW_ATTENTION: SessionAttentionPreview = {
  notifyMe: [],
  unread: [
    { sessionId: "playground-tab-row", threadKey: "q-9482", label: "q-9482", timestamp: NOW - 2 * MINUTE },
    { sessionId: "playground-tab-row", threadKey: "q-9479", label: "q-9479", timestamp: NOW - 9 * MINUTE },
  ],
};

function PhoneFrame({
  placement,
  topics = false,
  desktopChip = false,
}: {
  placement: "top" | "bottom";
  topics?: boolean;
  /** A desktop-width bar with the session's Next chip right after the tabs. */
  desktopChip?: boolean;
}) {
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
      className={`${desktopChip ? "w-[900px]" : "w-[430px]"} max-w-full rounded-lg border border-cc-border bg-cc-card px-3`}
      data-testid="playground-thread-tab-groups"
    >
      <ThreadTabGroupBar
        main={MAIN}
        tabs={tabs}
        placement={placement}
        currentThreadKey={current}
        activeOutputThreadKey={topics ? WRITING_THREAD : "q-9482"}
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
        trailing={
          desktopChip && (
            <NotificationChip
              sessionId="playground-tab-row"
              currentThreadKey="main"
              attentionPreview={TAB_ROW_ATTENTION}
              placement="top"
              docked
            />
          )
        }
        topicsGroup={
          topics
            ? {
                topics: TOPICS,
                currentTopicId: topicOpen,
                onOpen: (topic) => setTopicOpen(topic.id),
                topicOfQuest: TOPIC_OF_QUEST,
              }
            : undefined
        }
        threadsMenu={topics ? threadsMenu(select) : undefined}
      />
    </div>
  );
}

/**
 * A desktop leader with topics on: Main | All, Topics and the Next chip after the session name,
 * Working on (which holds the work board) before the bell, and the quest strip starting with its topic.
 */
function TopBarFrame() {
  const [current, setCurrent] = useState("q-9482");
  const [helpers, setHelpers] = useState<HTMLDivElement | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  return (
    <div className="w-[1000px] max-w-full overflow-visible rounded-lg border border-cc-border bg-cc-bg">
      <div className="flex items-center gap-3 border-b border-cc-border bg-cc-card px-4 py-1.5 text-[11px]">
        <span className="shrink-0 font-medium text-cc-fg">#2957 Daily Leader</span>
        <div className="flex min-w-0 flex-1 items-center">
          <ThreadTabGroupBar
            main={MAIN}
            tabs={TABS}
            currentThreadKey={current}
            activeOutputThreadKey={null}
            onSelect={setCurrent}
            trailing={
              <NotificationChip
                sessionId="playground-tab-row"
                currentThreadKey="main"
                attentionPreview={TAB_ROW_ATTENTION}
                placement="top"
                docked
              />
            }
            topicsGroup={{ topics: TOPICS, currentTopicId: null, onOpen: () => {}, topicOfQuest: TOPIC_OF_QUEST }}
            threadsMenu={threadsMenu(setCurrent)}
            inTopBar={{
              helpers,
              board: { open: boardOpen, dots: [], onToggle: () => setBoardOpen((open) => !open) },
            }}
          />
        </div>
        <div ref={setHelpers} className="flex items-center" />
      </div>
      {boardOpen && <div className="border-b border-cc-border px-4 py-2 text-[12px] text-cc-muted">(work board)</div>}
      <QuestThreadBanner
        threadKey={current}
        row={{ threadKey: current, questId: current, title: "Daily briefing: October 27" } as never}
        singleLine
        leading={<TopicCrumb name="Daily briefing" onOpen={() => {}} />}
      />
    </div>
  );
}

/** The New thread page (until its first message), and a thread's header once filed under a topic. */
function NewThreadFrames() {
  return (
    <div className="w-[600px] max-w-full space-y-3">
      <div className="flex h-56 flex-col overflow-hidden rounded-lg border border-cc-border bg-cc-bg">
        <NewThreadHeader leaderId="playground" startedFrom={null} onClearStartedFrom={() => {}} onClose={() => {}} />
        <NewThreadBody leaderId="playground" startedFrom={null} />
      </div>
      <div className="overflow-hidden rounded-lg border border-cc-border bg-cc-bg">
        <ThreadHeader leaderId="playground" thread={THREADS[3]!} onOpenThread={() => {}} />
      </div>
    </div>
  );
}

export function PlaygroundThreadTabGroupsSection() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Thread Tab Groups"
        description="Leader thread tabs on every screen size. Without topics: Main and one item per kind of tab (prompts waiting, in progress with phase-color dots, unread results, done); wide screens add each group's name. With topics on, the bar is topic-first: Main, Working on (the unfinished quests) and Topics, where each topic says what its quests are doing (in progress, new answers, Notify me) and quests under no topic are listed below. The quest strip names the current quest, so the bar only marks the group that holds it. On desktop the session's Next chip sits right after the tabs, where it never covers the feed's text; a desktop leader with topics on has no tab row: Main | All, Topics, Threads and the Next chip sit in the top bar after the session name, Working on (merged with the Board button, the full board behind a button in its menu) before the bell, Topics, Threads and Working on carry no bell (Next and the attention count do; their lists mark each item), and the quest strip starts with the quest's topic. A group lists its tabs (a group of one opens its tab directly; long-press shows the list); the Done list offers Close all. Finding a tab (open or closed) or a message is Search everything's Tabs and Messages modes. For a leader with Library topics on, a Topics group right after Main lists its topics by recent activity, each with its newest update; tapping one reads it as one conversation, and the group stays selected, with that topic marked, while it is on screen. Next to Topics, the Threads menu starts a new thread (a fresh conversation with the leader) and lists the threads the user started: Active while the leader is writing or an answer is unread (its row says how many), then Recent once read; a read thread filed under a topic lives in that topic. Working on lists only quests."
      >
        <div className="space-y-4">
          <Card label="At the top (tap a group)">
            <PhoneFrame placement="top" />
          </Card>
          <Card label="Topics on (open Topics, pick one; open Threads for the threads you started)">
            <PhoneFrame placement="top" topics />
          </Card>
          <Card label="Desktop, topics off: the Next chip right after the tabs">
            <PhoneFrame placement="top" desktopChip />
          </Card>
          <Card label="Desktop, topics on: the tabs in the top bar, the topic in the quest strip">
            <TopBarFrame />
          </Card>
          <Card label="New thread page, and a thread filed under a topic">
            <NewThreadFrames />
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
