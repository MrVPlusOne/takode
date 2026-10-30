/**
 * A leader's thread navigation: with topics off, the status-group tab row (at the top and at the
 * bottom of the screen); with topics on, the breadcrumb (place picker at the start of the strip)
 * and the Working on picker in the top bar, on phones and desktop alike; and the side chats list.
 */
import { QuestThreadBanner } from "../QuestThreadBanner.js";
import { useState } from "react";
import { getQuestJourneyPhase } from "../../../shared/quest-journey.js";
import { getQuestPhaseAccentValue, getQuestPhaseThreadTabTitleColorValue } from "../../utils/quest-phase-theme.js";
import type { ThreadSummary, TopicSummary } from "../../../shared/library-topics.js";
import { ThreadsList, type ThreadsMenu } from "../ThreadsMenu.js";
import { LeaderBreadcrumbNav } from "../breadcrumb/LeaderBreadcrumbNav.js";
import { CrumbStart, CrumbStrip, ThreadCrumb } from "../breadcrumb/CrumbStart.js";
import { useCrumbSlot } from "../breadcrumb/crumb-slot.js";
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

/** For a leader with topics on: its topics by recent activity, for the place picker. */
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
 * A leader's side chats for the side column's Recent list: one the leader is answering, one with an
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
    onOpen,
    unread: (threadKey) => THREAD_UNREAD[threadKey] ?? 0,
    questions: (threadKey) => THREAD_QUESTIONS[threadKey] ?? 0,
    onRemove: () => {},
  };
}

function PhoneFrame({
  placement,
  wide = false,
}: {
  placement: "top" | "bottom";
  /** A desktop-width bar. */
  wide?: boolean;
}) {
  const [current, setCurrent] = useState("q-9482");
  const [tabs, setTabs] = useState(TABS);
  const close = (threadKey: string) => {
    setTabs((existing) => existing.filter((tab) => tab.threadKey !== threadKey));
  };
  return (
    <div
      className={`${wide ? "w-[900px]" : "w-[430px]"} max-w-full rounded-lg border border-cc-border bg-cc-card px-3`}
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
        onSelect={setCurrent}
        onClose={close}
      />
    </div>
  );
}

/**
 * A leader with topics on (phones and desktop alike): the top bar with the Working on picker before
 * the bell, and the strip under it starting with the place picker, then the quest or thread.
 */
function BreadcrumbFrame({ width, sessionId }: { width: number; sessionId: string }) {
  const [current, setCurrent] = useState("q-9482");
  const [topicOpen, setTopicOpen] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<HTMLDivElement | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const crumbSlot = useCrumbSlot(sessionId, true);
  const thread = THREADS.find((candidate) => candidate.key === current);
  return (
    <div className="relative max-w-full overflow-visible rounded-lg border border-cc-border bg-cc-bg" style={{ width }}>
      <div className="relative flex items-center gap-3 border-b border-cc-border bg-cc-card px-4 py-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate font-medium text-cc-fg">
          #2957 Daily Leader · opus-5.5 · Full access
        </span>
        <div ref={setHelpers} className="flex items-center" />
      </div>
      {boardOpen && <div className="border-b border-cc-border px-4 py-2 text-[12px] text-cc-muted">(work board)</div>}
      {thread ? (
        <CrumbStrip sessionId={sessionId}>
          <ThreadCrumb leaderId={sessionId} thread={thread} onOpen={setCurrent} />
        </CrumbStrip>
      ) : current === "main" || current === "all" ? (
        <CrumbStrip sessionId={sessionId} />
      ) : (
        <QuestThreadBanner
          threadKey={current}
          row={
            {
              threadKey: current,
              questId: current,
              title: TABS.find((tab) => tab.threadKey === current)?.title,
            } as never
          }
          singleLine
          leading={<CrumbStart sessionId={sessionId} />}
        />
      )}
      <LeaderBreadcrumbNav
        leaderId={sessionId}
        main={MAIN}
        tabs={TABS}
        currentThreadKey={current}
        activeOutputThreadKey={WRITING_THREAD}
        onSelect={(key) => {
          setCurrent(key);
          setTopicOpen(null);
        }}
        topics={{
          list: TOPICS,
          currentTopicId: topicOpen,
          topicOfQuest: TOPIC_OF_QUEST,
          onOpen: (topic) => setTopicOpen(topic.id),
        }}
        threads={THREADS}
        helpers={helpers}
        crumbSlot={crumbSlot}
        board={{ open: boardOpen, dots: [], onToggle: () => setBoardOpen((open) => !open) }}
      />
    </div>
  );
}

export function PlaygroundThreadTabGroupsSection() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Thread Tab Groups"
        description="A leader's thread navigation. With topics off: the tab row, Main and one item per kind of tab (prompts waiting, in progress with phase-color dots, unread results, done); wide screens add each group's name; a group lists its tabs (a group of one opens its tab directly; long-press shows the list) and the Done list offers Close all. With topics on, phones and desktop alike have no tab row: the strip under the top bar is a breadcrumb whose first part picks the place (Main, All threads, then the topics, each saying what its quests are doing, and the quests under no topic), and the top bar's Working on picker lists the quests in motion, with the full board behind a button in its list. Side chats (threads the user started) live in the side column; its Recent list shows those with something for the user first, then every one read."
      >
        <div className="space-y-4">
          <Card label="Topics off, at the top (tap a group)">
            <PhoneFrame placement="top" />
          </Card>
          <Card label="Topics off, desktop width">
            <PhoneFrame placement="top" wide />
          </Card>
          <Card label="Topics on, phone: Working on in the top bar, the place picker starting the strip">
            <BreadcrumbFrame width={430} sessionId="playground-crumbs-phone" />
          </Card>
          <Card label="Topics on, desktop">
            <BreadcrumbFrame width={1000} sessionId="playground-crumbs-desktop" />
          </Card>
          <Card label="Side chats (the side column's Recent list)">
            <div className="w-[22rem] max-w-full rounded-xl border border-cc-border bg-cc-card py-1">
              <ThreadsList menu={threadsMenu(() => {})} currentKey="" writingKey={WRITING_THREAD} />
            </div>
          </Card>
          <Card label="Topics off, at the bottom (lists open upward)">
            <div className="pt-72">
              <PhoneFrame placement="bottom" />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
