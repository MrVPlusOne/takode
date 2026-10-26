import { useEffect } from "react";
import { useStore } from "../../store.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../../../shared/leader-thread-tabs-projection.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../../test-fixtures/leader-thread-tabs-projection.js";
import type { ThreadMonitoringEntry } from "../../../shared/thread-monitoring.js";
import { useAttentionNavigator } from "../../hooks/useAttentionNavigator.js";
import type { SessionNotification } from "../../types.js";
import { buildAttentionBacklog, buildNextAttentionQueue } from "../../utils/next-attention.js";
import { AttentionListPill, GlobalAttentionPanel } from "../GlobalAttentionMenu.js";
import { NavigationButtons, NavigationHistoryPanel } from "../NavigationButtons.js";
import { SidebarGlobalSearch } from "../SidebarGlobalSearch.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.now();
const SESSIONS = [
  { sessionId: "playground-attention-leader", sessionNum: 2851, name: "DevBox takode" },
  { sessionId: "playground-attention-worker", sessionNum: 2920, name: "Redesign the attention navigators" },
  { sessionId: "playground-attention-other", sessionNum: 2855, name: "Codex login refresh" },
];
const QUEST_TITLES: Record<string, string> = {
  "q-2428": "Make offline hosts obvious in the session list",
  "q-2416": "Restart Server pulls the latest published code",
  "q-2415": "Restart must not hang waiting for accepted work",
};

function prompt(sessionId: string, id: string, summary: string, minutesAgo: number, threadKey?: string) {
  const notification = {
    id,
    category: "needs-input",
    summary,
    timestamp: NOW - minutesAgo * 60_000,
    messageId: `mock-${id}`,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
    done: false,
  } as SessionNotification;
  return { sessionId, sessionName: "", sessionNum: null, notification };
}

function mutedPrompt(sessionId: string, id: string, summary: string, minutesAgo: number) {
  const entry = prompt(sessionId, id, summary, minutesAgo);
  return { ...entry, notification: { ...entry.notification, muted: true } };
}

const NOTIFY_ME: ThreadMonitoringEntry = {
  sessionId: "playground-attention-leader",
  sessionName: "DevBox takode",
  sessionNum: 2851,
  threadKey: "q-2416",
  title: "q-2416 Restart Server pulls the latest published code",
  trackedAt: 0,
  pending: { id: "7", messageId: "mock-notify", timestamp: NOW - 20 * 60_000, summary: "Landed; restart picks it up." },
};

/** A "Remind me later" on an answer that came due: shown right after the questions. */
const DUE_REMINDER: ThreadMonitoringEntry = {
  ...NOTIFY_ME,
  threadKey: "q-2428",
  title: "q-2428 Make offline hosts obvious in the session list",
  pending: {
    id: "8",
    messageId: "mock-reminder",
    timestamp: NOW - 2 * 60_000,
    summary: "Reminder: q-2428 Make offline hosts obvious in the session list",
    reminder: true,
  },
};

/** One unread answer, report or finished quest of the leader, as the per-message list shows it. */
function unreadMessage(id: string, threadKey: string, label: string, minutesAgo: number, summary: string) {
  const timestamp = NOW - minutesAgo * 60_000;
  return {
    sessionId: "playground-attention-leader",
    threadKey,
    label,
    timestamp,
    summary,
    notification: {
      id,
      category: "review",
      unreadReason: "answer",
      summary,
      timestamp,
      messageId: `mock-${id}`,
      threadKey,
      done: false,
    } as SessionNotification,
  };
}

const TOPICS: Record<string, { id: string; name: string }> = {
  "q-2416": { id: "topic-restart", name: "Restart Server" },
  "q-2415": { id: "topic-restart", name: "Restart Server" },
};

/**
 * A realistic cross-session queue: questions, a reminder that came due, unread answers grouped
 * by topic (two in Restart Server, one in Main), and a watched quest's result.
 */
const QUEUE = buildNextAttentionQueue({
  needsInput: [
    prompt("playground-attention-leader", "n-1", "Make offline hosts obvious: pick a chip style", 59, "q-2428"),
    prompt("playground-attention-other", "n-2", "Rotate the Codex token now or after the Execute window?", 45),
  ],
  notifyMe: [NOTIFY_ME, DUE_REMINDER],
  unread: [
    unreadMessage("r-1", "main", "Main", 18, "Answer in Main | The phone fix landed; restart when convenient."),
    unreadMessage("r-2", "q-2416", QUEST_TITLES["q-2416"]!, 12, "Restart now updates the checkout first."),
    unreadMessage("r-3", "q-2415", QUEST_TITLES["q-2415"]!, 240, "A restart no longer waits on accepted work."),
    {
      sessionId: "playground-attention-worker",
      threadKey: null,
      label: "Redesign the attention navigators",
      timestamp: NOW - 5 * 3_600_000,
    },
  ],
  topicOf: (_sessionId, threadKey) => (threadKey ? (TOPICS[threadKey] ?? null) : null),
});

/** Below the queue, collapsed: one muted prompt and one tracked thread still waiting for a result. */
const BACKLOG = buildAttentionBacklog({
  muted: [mutedPrompt("playground-attention-worker", "n-9", "Rename the attention sections now or later?", 300)],
  tracked: [
    {
      sessionId: "playground-attention-leader",
      sessionName: "DevBox takode",
      sessionNum: 2851,
      threadKey: "q-2415",
      title: "q-2415 Restart must not hang waiting for accepted work",
      trackedAt: NOW - 26 * 3_600_000,
      pending: null,
    },
  ],
});

const VIEWED_TABS = [
  { sessionId: "playground-attention-leader", threadKey: "q-2428", viewedAt: NOW - 10_000 },
  { sessionId: "playground-attention-leader", threadKey: "main", viewedAt: NOW - 3 * 60_000 },
  { sessionId: "playground-attention-worker", threadKey: null, viewedAt: NOW - 9 * 60_000 },
  { sessionId: "playground-attention-leader", threadKey: "q-2416", viewedAt: NOW - 40 * 60_000 },
  { sessionId: "playground-attention-other", threadKey: null, viewedAt: NOW - 2 * 3_600_000 },
];

/** The list with a working Next: the "Next" marker and position move through the whole list. */
/** The leader's tab state, so its unread quest row offers Close tab like a real one. */
function useSeedLeaderTabs() {
  useEffect(() => {
    const store = useStore.getState();
    store.applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "playground-attention-leader",
        generation: "playground-attention-list",
        value: createLeaderThreadTabsProjectionValue({
          tabState: { version: 1, orderedOpenThreadKeys: ["q-2415"], closedThreadTombstones: [], updatedAt: 1 },
          tabs: [createLeaderThreadTabsProjectionTab("q-2415", { canClose: true })],
        }),
      }),
    );
    return () => store.clearSyncedProjectionKey(LEADER_THREAD_TABS_PROJECTION, "playground-attention-leader");
  }, []);
}

function InteractiveAttentionList() {
  useSeedLeaderTabs();
  const { next, goNext, open } = useAttentionNavigator("playground:global-attention", QUEUE, { navigate: false });
  return (
    <div className="max-w-md space-y-2">
      <GlobalAttentionPanel
        inline
        items={QUEUE}
        nextKey={next?.item.key ?? null}
        nextPosition={next ? next.position + 1 : null}
        onClose={() => {}}
        onNext={() => goNext()}
        onOpen={open}
        backlog={BACKLOG}
        sessionsOverride={SESSIONS}
        threadsOverride={{
          titleFor: (_sessionId, threadKey) => QUEST_TITLES[threadKey],
          hasThreadTabs: (sessionId) => sessionId === "playground-attention-leader",
        }}
      />
    </div>
  );
}

/** Phone top bar mock: ≡, two-line identity and the attention list. */
function PhoneTopBar() {
  return (
    <div className="flex w-[390px] shrink-0 items-center gap-2 rounded-lg border border-cc-border bg-cc-card px-2 py-1.5">
      <span className="h-9 w-9 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true" />
      <span className="relative shrink-0" aria-hidden="true">
        <span className="block h-8 w-8 rounded-full bg-cc-hover" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-cc-success ring-2 ring-cc-card" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-tight text-cc-fg">
          Remote terminal and host setup cleanup
        </span>
        <span className="text-[11px] leading-tight text-cc-muted">#2851</span>
      </span>
      <AttentionListPill count={2} topKind="needs-input" compact />
    </div>
  );
}

export function PlaygroundNextAttentionSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Attention List, Phone Top Bar and Desktop Navigation"
        description="The top-bar count opens everything across sessions that needs the user, grouped as needs-input prompts, then Notify Me results, then unread results (newest first in each group), each with Go to. A row's second line names the thread tab it belongs to (quest ID and tab title, or Main, then the session number and age) and otherwise its session; Notify Me rows lead with the result, unread rows with the unread result itself (the answer, report or finished quest), never a later Thread Ready summary. Rows keep only Go to; right-click or long-press a row for the actions that fit its kind (Mute and Remind me later for prompts, Acknowledge and Stop tracking for Notify Me, Mark as read, and Close tab for any closable quest tab, which the server closes and keeps open while its quest is active). Next in the list (and the Next Item Across Sessions shortcut) walks the whole list into the lower groups and wraps; the row it opens next is marked. No banner says where a step went: the session and tab it opens show that. The pill takes the color of the most urgent kind waiting; while a prompt is open it counts only the open prompts, otherwise everything in the list. Below the list, collapsed and skipped by Next, sit Muted questions and tracked Notify Me threads with no result yet; with only those, the pill is a quiet bell without a count. The top bar keeps only ≡, the title and this list (leaders also get the Board button); diffs open from the quest banner chip. On desktop the sidebar header carries Back and Forward, which walk browser history and fade when there is no step, and Recently viewed, which lists the sessions and leader tabs viewed in this browser, newest first."
      >
        <div className="grid gap-4" data-testid="playground-next-attention">
          <Card label="Attention list pill (desktop and phone; amber counts only open questions, blue counts everything waiting, quiet bell when only muted or tracked items remain)">
            <div className="flex items-center gap-3">
              <AttentionListPill count={1} topKind="needs-input" />
              <AttentionListPill count={2} topKind="unread" />
              <AttentionListPill count={2} topKind="needs-input" compact open />
              <AttentionListPill count={1} topKind="notify-me" compact />
              <AttentionListPill count={0} topKind={undefined} />
            </div>
          </Card>
          <Card label="Attention list with Next (click Next to walk it)">
            <InteractiveAttentionList />
          </Card>
          <Card label="Phone top bar">
            <div className="overflow-x-auto">
              <PhoneTopBar />
            </div>
          </Card>
          <Card label="Desktop sidebar header: back, forward and Recently viewed (newest first, the tab on screen marked Current)">
            <div className="max-w-sm space-y-3">
              <div className="flex justify-end">
                <NavigationButtons />
              </div>
              <NavigationHistoryPanel
                inline
                onClose={() => {}}
                entriesOverride={VIEWED_TABS}
                sessionsOverride={SESSIONS}
                threadsOverride={{
                  titleFor: (_sessionId, threadKey) => QUEST_TITLES[threadKey],
                  hasThreadTabs: (sessionId) => sessionId === "playground-attention-leader",
                }}
              />
            </div>
          </Card>
          <Card label="Sessions panel global search (desktop and phone)">
            <div className="w-[228px]">
              <SidebarGlobalSearch closePanelOnOpen={false} />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
