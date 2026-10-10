import { useEffect, useState } from "react";
import { useStore } from "../../store.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../../../shared/leader-thread-tabs-projection.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../../test-fixtures/leader-thread-tabs-projection.js";
import type { ThreadMonitoringEntry } from "../../../shared/thread-monitoring.js";
import { useAttentionNavigator, type NextAttentionLanding } from "../../hooks/useAttentionNavigator.js";
import type { SessionNotification } from "../../types.js";
import { buildNextAttentionQueue } from "../../utils/next-attention.js";
import { NextAttentionToast } from "../AttentionKind.js";
import { AttentionListPill, GlobalAttentionPanel } from "../GlobalAttentionMenu.js";
import { SidebarQuickActions } from "../SidebarQuickActions.js";
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

const NOTIFY_ME: ThreadMonitoringEntry = {
  sessionId: "playground-attention-leader",
  sessionName: "DevBox takode",
  sessionNum: 2851,
  threadKey: "q-2416",
  title: "q-2416 Restart Server pulls the latest published code",
  trackedAt: 0,
  pending: { id: "7", messageId: "mock-notify", timestamp: NOW - 20 * 60_000, summary: "Landed; restart picks it up." },
};

/** A realistic cross-session queue: two prompts, one Notify Me result and three unread results. */
const QUEUE = buildNextAttentionQueue({
  needsInput: [
    prompt("playground-attention-leader", "n-1", "Make offline hosts obvious: pick a chip style", 59, "q-2428"),
    prompt("playground-attention-other", "n-2", "Rotate the Codex token now or after the Execute window?", 45),
  ],
  notifyMe: [NOTIFY_ME],
  unread: [
    {
      sessionId: "playground-attention-leader",
      threadKey: "main",
      label: "Main",
      timestamp: NOW - 18 * 60_000,
      summary: "phone fix landed; restart when convenient",
    },
    {
      sessionId: "playground-attention-leader",
      threadKey: "q-2415",
      label: "Restart must not hang waiting for accepted work",
      timestamp: NOW - 4 * 3_600_000,
      summary: "landed and completed automatically",
    },
    {
      sessionId: "playground-attention-worker",
      threadKey: null,
      label: "Redesign the attention navigators",
      timestamp: NOW - 5 * 3_600_000,
    },
  ],
});

const LANDINGS: NextAttentionLanding[] = [
  { item: QUEUE[0]!, sessionNum: 2851, position: 1, total: QUEUE.length },
  { item: QUEUE[2]!, sessionNum: 2851, position: 3, total: QUEUE.length },
  { item: QUEUE[4]!, sessionNum: 2851, position: 5, total: QUEUE.length },
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
  const [landing, setLanding] = useState<NextAttentionLanding | null>(null);
  return (
    <div className="max-w-md space-y-2">
      <GlobalAttentionPanel
        inline
        items={QUEUE}
        nextKey={next?.item.key ?? null}
        nextPosition={next ? next.position + 1 : null}
        onClose={() => {}}
        onNext={() => setLanding(goNext())}
        onOpen={open}
        sessionsOverride={SESSIONS}
        threadsOverride={{
          titleFor: (_sessionId, threadKey) => QUEST_TITLES[threadKey],
          hasThreadTabs: (sessionId) => sessionId === "playground-attention-leader",
        }}
      />
      {landing && <NextAttentionToast landing={landing} inline />}
    </div>
  );
}

/** Phone top bar mock: ≡ with its waiting dot, two-line identity and the attention list. */
function PhoneTopBar() {
  return (
    <div className="flex w-[390px] shrink-0 items-center gap-2 rounded-lg border border-cc-border bg-cc-card px-2 py-1.5">
      <span className="relative h-9 w-9 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true">
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-cc-attention ring-2 ring-cc-card" />
      </span>
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
      <AttentionListPill count={QUEUE.length} topKind="needs-input" compact />
    </div>
  );
}

export function PlaygroundNextAttentionSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Attention List and Phone Top Bar"
        description="The top-bar count opens everything across sessions that needs the user, grouped as needs-input prompts, then Notify Me results, then unread results (newest first in each group), each with Go to. A row's second line names the thread tab it belongs to (quest ID and tab title, or Main, then the session number and age) and otherwise its session; Notify Me rows lead with the result, unread rows with the thread's Thread Ready summary. Rows keep only Go to; right-click or long-press a row for the actions that fit its kind (Mute and Remind me later for prompts, Acknowledge and Stop tracking for Notify Me, Mark as read, and Close tab for any closable quest tab, which the server closes and keeps open while its quest is active). Next in the list (and the Next Item Needing Attention shortcut) walks the whole list into the lower groups and wraps; the row it opens next is marked, and a toast says where it landed. The pill takes the color of the most urgent kind waiting. The top bar keeps only ≡, the title and this list (leaders also get the Board button); diffs open from the quest banner chip."
      >
        <div className="grid gap-4" data-testid="playground-next-attention">
          <Card label="Attention list pill (desktop and phone; amber for prompts, blue for results)">
            <div className="flex items-center gap-3">
              <AttentionListPill count={6} topKind="needs-input" />
              <AttentionListPill count={2} topKind="unread" />
              <AttentionListPill count={6} topKind="needs-input" compact open />
              <AttentionListPill count={1} topKind="notify-me" compact />
            </div>
          </Card>
          <Card label="Attention list with Next (click Next to walk it)">
            <InteractiveAttentionList />
          </Card>
          <Card label="Toast after a jump">
            <div className="max-w-md space-y-2">
              {LANDINGS.map((landing) => (
                <NextAttentionToast key={landing.item.key} landing={landing} inline />
              ))}
            </div>
          </Card>
          <Card label="Phone top bar">
            <div className="overflow-x-auto">
              <PhoneTopBar />
            </div>
          </Card>
          <Card label="Sessions panel quick actions (desktop and phone)">
            <div className="w-[228px]">
              <SidebarQuickActions closePanelOnOpen={false} />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
