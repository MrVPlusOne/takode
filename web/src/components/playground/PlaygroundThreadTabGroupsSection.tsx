/**
 * A leader's thread navigation, phones and desktop alike: the status row under the top bar (Home,
 * then the leader's threads by what they need), the Board button in the top bar, the strip naming
 * the thread on screen with its topic tag, Home's full-width groups, and a joined thread's marker.
 */
import { useState } from "react";
import { getQuestJourneyPhase } from "../../../shared/quest-journey.js";
import type { ThreadSummary } from "../../../shared/library-topics.js";
import { getQuestPhaseAccentValue, getQuestPhaseThreadTabTitleColorValue } from "../../utils/quest-phase-theme.js";
import type { ChatMessage, SessionNotification } from "../../types.js";
import { LeaderBoardButton } from "../leader-workboard-controls.js";
import { MessageBubble } from "../MessageBubble.js";
import { QuestThreadBanner } from "../QuestThreadBanner.js";
import { ThreadJoinMarker } from "../ThreadJoinMarker.js";
import { ThreadStrip, TopicTag } from "../ThreadStrip.js";
import { plainThreadChip, ThreadGroupBar, ThreadGroupSections } from "../ThreadTabGroups.js";
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
    canClose: false,
    completed: !phase,
    titleColor: phase ? getQuestPhaseThreadTabTitleColorValue(phase.color) : "var(--color-cc-muted)",
    accentColor: phase ? getQuestPhaseAccentValue(phase.color) : "var(--color-cc-muted)",
    stateLabel: phase?.label ?? "Done",
    updatedAt: NOW - 5 * MINUTE,
    ...overrides,
  };
}

/** The leader's quest threads: in progress, waiting on the user, unread and done. */
const QUESTS: PrimaryThreadChip[] = [
  questTab("q-9482", "Redesign thread tabs around what the user scans", "work"),
  questTab("q-9481", "Thumb-reachable mobile layout for top-bar actions", "user-checkpoint", { needsInput: true }),
  // A side quest: its answer is given in q-9482, so the lists mark it with the branch icon.
  questTab("q-9480", "Keep the screen awake while recording voice", "memory", { sideQuestOf: "q-9482" }),
  questTab("q-9476", "Fix login-shell PATH capture on remote hosts", "landing"),
  questTab("q-9479", "Walk the paw down the feed as answers arrive", null, { blueNudge: true }),
  // A worker's question about one of the leader's quests: it opens the question.
  questTab("q-9477", "Compress old session histories", "work", {
    needsInput: true,
    stateLabel: "Question from #3301",
    onOpen: () => {},
  }),
  ...["Attribute a dismissed question to the leader", "Board dots contrast in light theme", "Sync unsent drafts"].map(
    (title, index) => questTab(`q-${9470 - index}`, title, null, { updatedAt: NOW - (index + 2) * 60 * MINUTE }),
  ),
];

/** The leader's other threads: one the leader is answering, one unread, one asking, two read. */
const THREADS: ThreadSummary[] = [
  playgroundThread("0a1b2c3d", "Phone can't reach Takode over Tailscale", 1),
  playgroundThread("1b2c3d4e", "Rocq vs Lean as a proof RL environment", 6),
  playgroundThread("4e5f6a7b", "Name for the daily summary", 12, {
    topic: { id: "topic-briefing", name: "Daily briefing" },
  }),
  playgroundThread("2c3d4e5f", "Why the old draft came back", 50, { settledAt: NOW - 40 * MINUTE }),
  playgroundThread("3d4e5f6a", "Answer times on wrapped lines", 90, {
    settledAt: NOW - 80 * MINUTE,
    topic: { id: "topic-feed", name: "Feed polish" },
  }),
];
const NOTIFICATIONS = [
  notification("n-1", "review", "topic:1b2c3d4e"),
  notification("n-2", "needs-input", "topic:4e5f6a7b"),
] as SessionNotification[];
const WRITING_THREAD = "topic:0a1b2c3d";

const MEMBERS: PrimaryThreadChip[] = [
  ...QUESTS,
  ...THREADS.map((thread) => plainThreadChip(thread, NOTIFICATIONS, thread.key === WRITING_THREAD)),
];

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

function notification(id: string, category: "review" | "needs-input", threadKey: string) {
  return { id, category, summary: "", timestamp: NOW, threadKey, done: false };
}

/** A leader: the top bar with the Board button, the status row, then the strip of the thread on screen. */
function LeaderFrame({ width }: { width: number }) {
  const [current, setCurrent] = useState("q-9482");
  const [boardOpen, setBoardOpen] = useState(false);
  const thread = THREADS.find((candidate) => candidate.key === current);
  const quest = QUESTS.find((candidate) => candidate.threadKey === current);
  return (
    <div className="relative max-w-full overflow-visible rounded-lg border border-cc-border bg-cc-bg" style={{ width }}>
      <div className="relative flex items-center gap-3 border-b border-cc-border bg-cc-card px-4 py-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate font-medium text-cc-fg">
          #2957 Daily Leader · opus-5.5 · Full access
        </span>
        <LeaderBoardButton
          dots={[]}
          open={boardOpen}
          onToggle={() => setBoardOpen((open) => !open)}
          desktop={width > 600}
        />
      </div>
      <ThreadGroupBar
        threads={MEMBERS}
        currentThreadKey={current}
        activeOutputThreadKey={WRITING_THREAD}
        onSelect={setCurrent}
      />
      {boardOpen && <div className="border-b border-cc-border px-4 py-2 text-[12px] text-cc-muted">(work board)</div>}
      {thread ? (
        <ThreadStrip
          thread={thread}
          topic={thread.topic ?? null}
          onOpenTopic={() => {}}
          onLeave={() => setCurrent("main")}
        />
      ) : quest ? (
        <QuestThreadBanner
          threadKey={current}
          row={{ threadKey: current, questId: current, title: quest.title } as never}
          singleLine
          topicTag={<TopicTag name="Leader navigation" onOpen={() => {}} />}
          onCloseTab={() => setCurrent("main")}
          closeLabel="Back to Home"
        />
      ) : (
        <div className="border-b border-cc-border bg-cc-card px-4 py-1.5 text-[12px] text-cc-muted">Home</div>
      )}
    </div>
  );
}

const JOIN_EARLIER_USER: ChatMessage = {
  id: "join-earlier-user",
  role: "user",
  content: "The collapsed composer on my phone sits too low; the home bar covers its bottom edge.",
  timestamp: NOW - 26 * 60 * MINUTE,
};
const JOIN_EARLIER_ANSWER: ChatMessage = {
  id: "join-earlier-answer",
  role: "assistant",
  content: "",
  contentBlocks: [{ type: "text", text: "Fixed: the collapsed composer now sits above the home bar (q-2936)." }],
  timestamp: NOW - 25 * 60 * MINUTE,
};
const JOIN_NEW_USER: ChatMessage = {
  id: "join-new-user",
  role: "user",
  content: "The composer is a little high now when the keyboard is closed. Can we split the difference?",
  timestamp: NOW - 5 * MINUTE,
};

export function PlaygroundThreadTabGroupsSection() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Thread Tab Groups"
        description="A leader's navigation, phones and desktop alike: the status row under the top bar lists Home, then the leader's threads (quest threads and its other threads alike) by what they need: Needs you, Unread, In progress and Idle (In progress only while work goes on: a running quest, or the thread the leader is answering in). A group of one opens its thread; a larger group opens its list. The strip names the thread on screen with its topic tag, which opens the topic's page. Home shows the same groups at full width."
      >
        <div className="space-y-4">
          <Card label="Phone">
            <LeaderFrame width={430} />
          </Card>
          <Card label="Desktop">
            <LeaderFrame width={1000} />
          </Card>
          <Card label="Home: the same groups at full width">
            <div className="w-[44rem] max-w-full rounded-xl border border-cc-border bg-cc-card pb-1">
              <ThreadGroupSections
                threads={MEMBERS}
                context={{ currentThreadKey: "main", activeOutputThreadKey: WRITING_THREAD, onSelect: () => {} }}
                idleLimit={2}
              />
            </div>
          </Card>
          <Card label="A thread joined onto the conversation it continues">
            <div
              className="w-[44rem] max-w-full space-y-2 rounded-xl border border-cc-border bg-cc-bg p-3"
              data-testid="playground-thread-join"
            >
              <MessageBubble message={JOIN_EARLIER_USER} />
              <MessageBubble message={JOIN_EARLIER_ANSWER} />
              <ThreadJoinMarker earlierName="Collapsed phone composer sits a little higher" onUndo={() => {}} />
              <MessageBubble message={JOIN_NEW_USER} />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
