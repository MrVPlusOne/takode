import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { UniversalSearchOverlay } from "../UniversalSearchOverlay.js";
import { TreeViewGroup } from "../TreeViewGroup.js";
import type { GlobalStarredMessageSearchResponse, MessageSearchResponse, RecentAskBundlesResponse } from "../../api.js";
import type { ChatMessage, SdkSessionInfo } from "../../types.js";
import type { SidebarSessionItem } from "../../utils/sidebar-session-item.js";
import type { TreeViewGroupData } from "../../utils/tree-grouping.js";
import { Card, Section } from "./shared.js";

const PLAYGROUND_UNIVERSAL_SESSIONS: SdkSessionInfo[] = [
  {
    sessionId: "playground-universal",
    state: "connected",
    cwd: "/repo/takode",
    createdAt: Date.now() - 15 * 60_000,
    lastActivityAt: Date.now() - 2 * 60_000,
    name: "Universal search implementation",
    backendType: "codex",
    gitBranch: "feature/universal-search",
    sessionNum: 1277,
    isOrchestrator: true,
  },
  {
    sessionId: "playground-review",
    state: "connected",
    cwd: "/repo/takode",
    createdAt: Date.now() - 2 * 60 * 60_000,
    lastActivityAt: Date.now() - 35 * 60_000,
    name: "Review search overlay states",
    backendType: "claude",
    gitBranch: "review/sidebar-overflow",
    sessionNum: 1278,
  },
];

const PLAYGROUND_RECENT_ASKS_RESPONSE: RecentAskBundlesResponse = {
  groups: [
    {
      id: "playground-universal:recent-q-1931",
      sessionId: "playground-universal",
      sessionNum: 1277,
      sessionName: "Universal search implementation",
      sessionState: "running",
      archived: false,
      sessionSpaceId: "takode",
      sessionSpaceName: "Takode",
      ownerThreadKey: "q-1931",
      questId: "q-1931",
      questTitle: "Separate Recent browsing from message search",
      questStatus: "in_progress",
      firstAskedAt: Date.now() - 6 * 60_000,
      lastAskedAt: Date.now() - 6 * 60_000,
      status: "working",
      members: [
        {
          messageId: "recent-q-1931-latest",
          historyIndex: 11,
          timestamp: Date.now() - 6 * 60_000,
          preview: "Keep Recent browse-only: show the newest human message from each destination.",
          truncated: false,
          imageCount: 1,
        },
      ],
    },
    {
      id: "playground-universal:recent-q-1927",
      sessionId: "playground-universal",
      sessionNum: 1277,
      sessionName: "Universal search implementation",
      sessionState: "connected",
      archived: false,
      sessionSpaceId: "takode",
      sessionSpaceName: "Takode",
      ownerThreadKey: "q-1927",
      questId: "q-1927",
      questTitle: "Inspect Parsewave batch and build viewer",
      questStatus: "in_progress",
      firstAskedAt: Date.now() - 18 * 60_000,
      lastAskedAt: Date.now() - 18 * 60_000,
      status: "needs_input",
      statusDetail: "The private data access choice still needs a human decision.",
      members: [
        {
          messageId: "recent-q-1927-latest",
          historyIndex: 7,
          timestamp: Date.now() - 18 * 60_000,
          preview: "Choose whether to continue with the private signed URL or pause the viewer build.",
          truncated: false,
          imageCount: 0,
        },
      ],
    },
    {
      id: "playground-review:recent-main",
      sessionId: "playground-review",
      sessionNum: 1278,
      sessionName: "Review search overlay states",
      sessionState: "exited",
      archived: true,
      sessionSpaceId: "review",
      sessionSpaceName: "Review",
      ownerThreadKey: "main",
      firstAskedAt: Date.now() - 45 * 60_000,
      lastAskedAt: Date.now() - 45 * 60_000,
      status: "response_unread",
      members: [
        {
          messageId: "recent-review-main-latest",
          historyIndex: 4,
          timestamp: Date.now() - 45 * 60_000,
          preview: "Review the mobile spacing and keyboard behavior.",
          truncated: false,
          imageCount: 0,
        },
      ],
      response: {
        messageId: "response-four",
        historyIndex: 5,
        timestamp: Date.now() - 40 * 60_000,
        preview: "The responsive and keyboard review is ready, but this body stays out of the dense card.",
        truncated: false,
      },
    },
  ],
  totalMatches: 3,
  totalRecentGroups: 3,
  limit: 50,
  query: "",
  filter: "all",
  sessionSpaceId: null,
  attentionCount: 2,
  sessionSpaces: [
    { id: "review", name: "Review", count: 1 },
    { id: "takode", name: "Takode", count: 2 },
  ],
  coverageNotice: "Recent shows one newest human message per destination. Use Messages to search every match in scope.",
  tookMs: 2,
};

const PLAYGROUND_UNIVERSAL_MESSAGE_RESPONSE: MessageSearchResponse = {
  sessionId: "playground-universal",
  sessionNum: 1277,
  query: "search",
  scope: { kind: "leader_all_tabs", label: "Searching in #1277 across tabs" },
  filters: { user: true, assistant: false, event: false },
  totalMatches: 3,
  nextOffset: null,
  hasMore: false,
  tookMs: 2,
  results: [
    {
      id: "playground-universal:11:search-new",
      sessionId: "playground-universal",
      sessionNum: 1277,
      messageId: "search-new",
      historyIndex: 11,
      role: "user",
      category: "user",
      starred: true,
      timestamp: Date.now() - 2 * 60_000,
      snippet: "Search should return every matching message in scope instead of one result per destination.",
      routeThreadKey: "q-1931",
      sourceThreadKey: "q-1931",
      sourceLabel: "Thread q-1931",
      questId: "q-1931",
    },
    {
      id: "playground-universal:8:search-older-same-tab",
      sessionId: "playground-universal",
      sessionNum: 1277,
      messageId: "search-older-same-tab",
      historyIndex: 8,
      role: "user",
      category: "user",
      starred: false,
      timestamp: Date.now() - 14 * 60_000,
      snippet: "When a search has two matching messages in this tab, keep both results.",
      routeThreadKey: "q-1931",
      sourceThreadKey: "q-1931",
      sourceLabel: "Thread q-1931",
      questId: "q-1931",
    },
    {
      id: "playground-universal:4:search-other-tab",
      sessionId: "playground-universal",
      sessionNum: 1277,
      messageId: "search-other-tab",
      historyIndex: 4,
      role: "user",
      category: "user",
      starred: false,
      timestamp: Date.now() - 30 * 60_000,
      snippet: "Search filters should remain available when inspecting another tab.",
      routeThreadKey: "q-1927",
      sourceThreadKey: "q-1927",
      sourceLabel: "Thread q-1927",
      questId: "q-1927",
    },
  ],
};

const PLAYGROUND_STARRED_SEARCH_RESPONSE: GlobalStarredMessageSearchResponse = {
  query: "",
  totalMatches: 2,
  nextOffset: null,
  hasMore: false,
  tookMs: 2,
  results: [
    {
      id: "playground-review:4:review-starred",
      sessionId: "playground-review",
      sessionNum: 1278,
      sessionName: "Review search overlay states",
      sessionState: "exited",
      archived: true,
      reviewerOf: 1277,
      messageId: "review-starred",
      historyIndex: 4,
      role: "assistant",
      category: "assistant",
      starred: true,
      starredAt: Date.now() - 3 * 60_000,
      timestamp: Date.now() - 40 * 60_000,
      snippet: "Starred review note about preserving explicit Main thread navigation.",
      routeThreadKey: "main",
      sourceThreadKey: "main",
      sourceLabel: "Main",
    },
    {
      id: "playground-universal:0:universal-user-new",
      sessionId: "playground-universal",
      sessionNum: 1277,
      sessionName: "Universal search implementation",
      sessionState: "connected",
      archived: false,
      messageId: "universal-user-new",
      historyIndex: 0,
      role: "user",
      category: "user",
      starred: true,
      starredAt: Date.now() - 8 * 60_000,
      timestamp: Date.now() - 2 * 60_000,
      snippet: "Can you make the universal search overlay keyboard efficient and mode scoped?",
      routeThreadKey: "main",
      sourceThreadKey: "main",
      sourceLabel: "Main",
    },
  ],
};

const PLAYGROUND_UNIVERSAL_MESSAGES: ChatMessage[] = [
  {
    id: "search-new",
    role: "user",
    content: "Search should return every matching message in scope instead of one result per destination.",
    timestamp: Date.now() - 2 * 60_000,
  },
  {
    id: "universal-assistant",
    role: "assistant",
    content: "Separated query-free Recent browsing from exhaustive Messages search within the selected scope.",
    timestamp: Date.now() - 90_000,
  },
  {
    id: "search-older-same-tab",
    role: "user",
    content: "When a search has two matching messages in this tab, keep both results.",
    timestamp: Date.now() - 14 * 60_000,
  },
  {
    id: "search-other-tab",
    role: "user",
    content: "Search filters should remain available when inspecting another tab.",
    timestamp: Date.now() - 30 * 60_000,
  },
];

function makeSidebarSession(
  id: string,
  index: number,
  overrides: Partial<SidebarSessionItem> = {},
): SidebarSessionItem {
  return {
    id,
    model: "gpt-5.5",
    cwd: "/repo/takode",
    gitBranch: index % 2 === 0 ? "feature/sidebar-overflow" : "main-wt-3498",
    isContainerized: false,
    gitAhead: index % 2,
    gitBehind: 0,
    linesAdded: index * 3,
    linesRemoved: index,
    isConnected: index < 4,
    status: index === 1 ? "running" : "idle",
    sdkState: index === 1 ? "running" : "connected",
    createdAt: Date.now() - index * 20 * 60_000,
    archived: false,
    backendType: index % 2 === 0 ? "codex" : "claude",
    repoRoot: "/repo/takode",
    permCount: index === 2 ? 1 : 0,
    lastActivityAt: Date.now() - index * 5 * 60_000,
    lastUserMessageAt: Date.now() - index * 6 * 60_000,
    sessionNum: 1280 + index,
    ...overrides,
  };
}

const PLAYGROUND_OVERFLOW_SESSIONS = [
  makeSidebarSession("overflow-plan", 0, { name: "Plan sidebar overflow" }),
  makeSidebarSession("overflow-implement", 1, { name: "Implement group folding" }),
  makeSidebarSession("overflow-review", 2, { name: "Review group drag order" }),
  makeSidebarSession("overflow-e2e", 3, { name: "Validate search jump" }),
  makeSidebarSession("overflow-docs", 4, { name: "Refresh phase notes" }),
  makeSidebarSession("overflow-followup", 5, { name: "Track follow-up polish" }),
];

const PLAYGROUND_OVERFLOW_GROUP: TreeViewGroupData = {
  id: "playground-overflow",
  name: "Quest Workers",
  nodes: PLAYGROUND_OVERFLOW_SESSIONS.map((session) => ({ leader: session, workers: [], reviewers: [] })),
  runningCount: 1,
  permCount: 1,
  unreadCount: 0,
};

const EMPTY_STRING_SET = new Set<string>();

function PlaygroundSidebarOverflowGroup({ expanded }: { expanded: boolean }) {
  const editInputRef = useRef<HTMLInputElement>(null);
  const collapsedTreeNodes = useMemo(() => new Set<string>(), []);
  const noop = () => {};
  const noopMouse = (_event: ReactMouseEvent, _id: string) => {};

  return (
    <DndContext collisionDetection={closestCenter}>
      <div className="max-w-sm rounded-lg border border-cc-border/70 bg-cc-sidebar/70 p-2">
        <TreeViewGroup
          group={PLAYGROUND_OVERFLOW_GROUP}
          isGroupCollapsed={false}
          collapsedTreeNodes={collapsedTreeNodes}
          onToggleGroupCollapse={noop}
          onToggleNodeCollapse={noop}
          onCreateSession={noop}
          currentSessionId="overflow-implement"
          recentlyRenamed={EMPTY_STRING_SET}
          onSelect={noop}
          onStartRename={noop}
          onArchive={noopMouse}
          onUnarchive={noopMouse}
          onDelete={noopMouse}
          onClearRecentlyRenamed={noop}
          editingSessionId={null}
          editingName=""
          setEditingName={noop}
          onConfirmRename={noop}
          onCancelRename={noop}
          editInputRef={editInputRef}
          isFirst
          visibleSessionLimit={3}
          overflowExpanded={expanded}
          onToggleOverflow={noop}
          onSetVisibleSessionLimit={noop}
        />
      </div>
    </DndContext>
  );
}

export function PlaygroundUniversalSearchStates() {
  return (
    <Section
      title="Universal Search"
      description="App-level command palette with browse-only Recent destinations, exhaustive Messages search within the selected scope, and explicit Quests, Sessions, and Starred modes."
    >
      <div className="space-y-4">
        <Card label="Recent browsing versus scoped Messages search">
          <div className="space-y-4">
            <div data-testid="playground-universal-recent-preview">
              <p className="mb-2 text-xs text-cc-muted">
                Recent shows one newest human message for each navigable destination.
              </p>
              <UniversalSearchOverlay
                open
                presentation="inline"
                initialMode="recent"
                currentSessionId="playground-universal"
                currentThreadKey="main"
                sessions={PLAYGROUND_UNIVERSAL_SESSIONS}
                messages={PLAYGROUND_UNIVERSAL_MESSAGES}
                leaderSessionId="playground-universal"
                recentAskPreviewResponse={PLAYGROUND_RECENT_ASKS_RESPONSE}
                onClose={() => {}}
                onOpenQuest={() => {}}
                onOpenMessage={() => {}}
              />
            </div>
            <div data-testid="playground-universal-messages-preview">
              <p className="mb-2 text-xs text-cc-muted">
                Messages keeps every match in the selected scope, including multiple messages from the same destination.
              </p>
              <UniversalSearchOverlay
                open
                presentation="inline"
                initialMode="messages"
                initialQuery="search"
                currentSessionId="playground-universal"
                currentThreadKey="all"
                sessions={PLAYGROUND_UNIVERSAL_SESSIONS}
                messages={PLAYGROUND_UNIVERSAL_MESSAGES}
                leaderSessionId="playground-universal"
                messageSearchPreviewResponse={PLAYGROUND_UNIVERSAL_MESSAGE_RESPONSE}
                onClose={() => {}}
                onOpenQuest={() => {}}
                onOpenMessage={() => {}}
              />
            </div>
          </div>
        </Card>
        <Card label="Overlay with Session mode results">
          <UniversalSearchOverlay
            open
            presentation="inline"
            initialMode="sessions"
            initialQuery="review"
            currentSessionId="playground-universal"
            currentThreadKey="main"
            sessions={PLAYGROUND_UNIVERSAL_SESSIONS}
            messages={PLAYGROUND_UNIVERSAL_MESSAGES}
            leaderSessionId="playground-universal"
            onClose={() => {}}
            onOpenQuest={() => {}}
            onOpenMessage={() => {}}
          />
        </Card>
        <Card label="Overlay with global Starred mode">
          <UniversalSearchOverlay
            open
            presentation="inline"
            initialMode="starred"
            currentSessionId="playground-universal"
            currentThreadKey="main"
            sessions={PLAYGROUND_UNIVERSAL_SESSIONS}
            messages={PLAYGROUND_UNIVERSAL_MESSAGES}
            leaderSessionId="playground-universal"
            starredSearchPreviewResponse={PLAYGROUND_STARRED_SEARCH_RESPONSE}
            onClose={() => {}}
            onOpenQuest={() => {}}
            onOpenMessage={() => {}}
          />
        </Card>
        <Card label="Overlay outside a session">
          <UniversalSearchOverlay
            open
            presentation="inline"
            currentSessionId={null}
            currentThreadKey={null}
            sessions={PLAYGROUND_UNIVERSAL_SESSIONS}
            messages={[]}
            onClose={() => {}}
            onOpenQuest={() => {}}
            onOpenMessage={() => {}}
          />
        </Card>
      </div>
    </Section>
  );
}

export function PlaygroundSidebarOverflowStates() {
  return (
    <Section
      title="Sidebar Group Overflow"
      description="Folded and expanded Session Space states for groups that exceed their visible session limit."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Folded group with overflow control">
          <PlaygroundSidebarOverflowGroup expanded={false} />
        </Card>
        <Card label="Expanded group with collapse control">
          <PlaygroundSidebarOverflowGroup expanded />
        </Card>
      </div>
    </Section>
  );
}
