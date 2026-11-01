import { Activity, useEffect, useRef, useState, type ReactNode } from "react";
import { setSideViewsOf } from "../../utils/side-views.js";
import { holdSessionConnection } from "../../ws.js";
import { useRememberedFolds } from "../../utils/remembered-folds.js";
import { SectionEdge, useSectionHeights } from "../StackedPanes.js";
import { useStore } from "../../store.js";
import {
  closeSideItem,
  HOME_ITEM,
  notePaneClick,
  openInSide,
  replaceSideItem,
  sideChatOrigin,
  sideFoldId,
  sideItemLeader,
  useSideColumn,
  type SideItem,
} from "../../utils/side-column.js";
import { setTopicPanelOpen, setTopicSheetOpen } from "../../utils/topic-panel.js";
import { loadLeaderNamesOnce, useKnownThreadOfKey, useThreadDestinations } from "../../utils/leader-topics.js";
import { useReadyThreadDestination } from "../../utils/ready-thread-destination.js";
import { navigateToSession, navigateToSessionThread, openQuestOverlayRouteAware } from "../../utils/routing.js";
import { resolveNotificationOwnerThreadKey } from "../../utils/notification-thread.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { isLeaderThreadRunning } from "../../utils/leader-thread-tabs-resolver.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { useKnownTopicBrief } from "../../utils/leader-topics.js";
import { CollapseIcon, NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { TopicSidePanel } from "../library/TopicSidePanel.js";
import { ThreadOriginName } from "./thread-names.js";
import { useQuestRecord } from "../QuestSummaryCard.js";
import { getQuestStatusTheme } from "../../utils/quest-status-theme.js";
import { SideConversation } from "./SideConversation.js";
import { NewSideChat } from "./NewSideChat.js";
import { SideChatLeaderMenu, useLeaderCard } from "./SideChatLeaders.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { SideQuest } from "./SideQuest.js";
import { SideSession } from "./SideSession.js";
import { ArtifactViewer } from "../library/ArtifactViewer.js";
import { LibraryIcon } from "../ArtifactInline.js";
import { BellIcon } from "../AttentionKind.js";
import { openLibraryArtifact } from "../../utils/library-nav.js";

/** Items whose page stays mounted (hidden) after another opens, so going back keeps its place. */
const KEPT_MOUNTED = 3;

/** How tall a section's header row is, for the default height of an open section. */
const ROW_HEIGHT = 36;

/**
 * A leader's side column (Logseq's right sidebar), from the top: whatever the user put beside the
 * conversation (threads, other conversations, topic pages, artifacts), newest first; then the
 * leader's topics, for browsing (the topic page of the thread on screen, else the list). Each
 * section folds on its own from its header row, any number can be open, and the column scrolls when
 * they don't fit. An open section's bottom edge drags to set its height (Jiayi's choice, Oct 31:
 * like Logseq, the panel scrolls rather than squeezing each section). Folds and heights are
 * remembered in this browser. On a phone it is the same column in a sheet.
 */
export function SideColumn({
  leaderId,
  threadKey,
  variant,
}: {
  leaderId: string;
  /** The thread on screen in the main view: the topic page follows it, and side chats start from it. */
  threadKey: string;
  variant: "docked" | "sheet";
}) {
  const { items, focus, focusAt } = useSideColumn(leaderId);
  const folds = useRememberedFolds();
  const foldId = (id: string) => sideFoldId(leaderId, id);
  const isOpen = (id: string) => !folds.isFolded(foldId(id));
  const toggle = (id: string) => folds.toggle(foldId(id));
  const heights = useSectionHeights(`side:${leaderId}`);
  const sectionIds = [...items.map((item) => item.id), HOME_ITEM];
  const idsKey = sectionIds.join(",");
  useEffect(() => heights.keepOnly(idsKey.split(",")), [idsKey]);
  // The scrolling area's height: one open section fits it beside every header row by default.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const fill = Math.max(160, viewport - ROW_HEIGHT * sectionIds.length);
  // Something just opened in the column scrolls into view (not on mount: the column stays as left).
  const sectionElements = useRef(new Map<string, HTMLElement>());
  const bodyElements = useRef(new Map<string, HTMLElement>());
  const shownFocus = useRef(focusAt);
  useEffect(() => {
    if (!focus || focusAt === shownFocus.current) return;
    shownFocus.current = focusAt;
    sectionElements.current.get(focus)?.scrollIntoView?.({ block: "nearest" });
  }, [focus, focusAt]);
  // Open sections stay mounted, and so do the last few folded ones, like kept conversations.
  const keptRef = useRef<string[]>([]);
  const openIds = sectionIds.filter(isOpen);
  keptRef.current = [...openIds, ...keptRef.current.filter((id) => !openIds.includes(id))]
    .filter((id) => sectionIds.includes(id))
    .slice(0, openIds.length + KEPT_MOUNTED);
  const kept = keptRef.current;
  const close = () => (variant === "sheet" ? setTopicSheetOpen(leaderId, false) : setTopicPanelOpen(leaderId, false));
  useEffect(() => loadLeaderNamesOnce(leaderId), [leaderId]);
  // Side chats with other leaders read and send over those leaders' connections, which the main
  // view doesn't keep open. Held per leader, so a new chat turning into its thread keeps the same
  // connection: dropping it in between loses the live messages of the chat's first turn.
  const otherLeaders = [...new Set(items.map((item) => sideItemLeader(leaderId, item)))]
    .filter((other) => other !== leaderId)
    .sort()
    .join(",");
  useEffect(() => {
    const releases = otherLeaders ? otherLeaders.split(",").map((other) => holdSessionConnection(other)) : [];
    return () => {
      for (const release of releases) release();
    };
  }, [otherLeaders]);
  // The server sends this browser the live messages of the conversations in the column too, each
  // over its leader's connection (a side chat with another leader is that leader's conversation).
  const conversationViews = items
    .flatMap((item) =>
      item.kind === "conversation" ? [`${sideItemLeader(leaderId, item)} ${item.threadKey.toLowerCase()}`] : [],
    )
    .join(",");
  useEffect(() => {
    const owner = {};
    const byLeader = new Map<string, string[]>([[leaderId, []]]);
    for (const view of conversationViews ? conversationViews.split(",") : []) {
      const [viewLeader, key] = view.split(" ");
      byLeader.set(viewLeader!, [...(byLeader.get(viewLeader!) ?? []), key!]);
    }
    for (const [viewLeader, keys] of byLeader) setSideViewsOf(viewLeader, owner, keys);
    return () => {
      for (const viewLeader of byLeader.keys()) setSideViewsOf(viewLeader, owner, []);
    };
  }, [conversationViews, leaderId]);

  /**
   * One section: its header row (sticky while its body scrolls past), then, while open, its body at
   * its height and the edge that sets it. A conversation keeps a fixed height (its feed scrolls
   * inside); a page is as tall as its content, up to that height.
   */
  const section = (id: string, row: ReactNode, body: ReactNode, fixed: boolean, defaultHeight: number) => {
    const open = isOpen(id);
    const dragged = heights.heightOf(id);
    const size = dragged ?? defaultHeight;
    return (
      <section
        key={id}
        ref={(element) => {
          if (element) sectionElements.current.set(id, element);
          else sectionElements.current.delete(id);
        }}
        data-section={id}
        data-open={open}
        data-testid="side-section"
      >
        <div className="sticky top-0 z-10 bg-cc-bg">{row}</div>
        {kept.includes(id) && (
          <Activity mode={open ? "visible" : "hidden"}>
            <div
              ref={(element) => {
                if (element) bodyElements.current.set(id, element);
                else bodyElements.current.delete(id);
              }}
              className="isolate flex min-h-0 flex-col overflow-hidden"
              style={fixed || dragged !== undefined ? { height: size } : { maxHeight: size }}
              data-testid="side-section-body"
            >
              {body}
            </div>
            <SectionEdge
              measure={() => bodyElements.current.get(id)?.getBoundingClientRect().height || size}
              onResize={(start, delta) => heights.resize(id, start, delta)}
              onReset={() => heights.reset(id)}
            />
          </Activity>
        )}
      </section>
    );
  };

  const itemSection = (entry: SideItem | null) => {
    const id = entry?.id ?? HOME_ITEM;
    const conversation = entry?.kind === "conversation" || entry?.kind === "new-chat" || entry?.kind === "session";
    const row = <SideItemRow leaderId={leaderId} item={entry} open={isOpen(id)} onOpen={() => toggle(id)} />;
    const body = (
      // A link clicked here opens in this pane; the open-in-side click opens it in the main view.
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="side-item-body"
        data-item={id}
        onClickCapture={(event) => notePaneClick(leaderId, entry?.id ?? null, event)}
      >
        <SideItemBody leaderId={leaderId} threadKey={threadKey} item={entry} variant={variant} />
      </div>
    );
    return section(id, row, body, conversation, fill);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="side-column">
      {/* As tall as the strip under the top bar, so their lines meet. */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-cc-border/80 px-2">
        <button
          type="button"
          onClick={() => openInSide(leaderId, { kind: "new-chat", startedFrom: sideChatOrigin(leaderId) })}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-cc-primary hover:bg-cc-hover"
          title="Start a thread with the leader about what's on screen"
          data-testid="side-new-chat"
        >
          <NewThreadIcon className="h-4 w-4" />
          New thread
        </button>
        <SideChatLeaderMenu columnId={leaderId} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={close}
          aria-label={variant === "sheet" ? "Close the side column" : "Collapse the side column"}
          title={variant === "sheet" ? "Close" : "Collapse"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        >
          {variant === "sheet" ? "✕" : <CollapseIcon className="h-4 w-4" />}
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="side-scroll">
        {items.map(itemSection)}
        {itemSection(null)}
      </div>
    </div>
  );
}

/** One item's header in the stack: its kind, its name, and its actions. */
function SideItemRow({
  leaderId,
  item,
  open,
  onOpen,
}: {
  leaderId: string;
  item: SideItem | null;
  open: boolean;
  onOpen: () => void;
}) {
  // A side chat with another leader reads as that leader's: its names, unread answers and portrait.
  const owner = item ? sideItemLeader(leaderId, item) : leaderId;
  const unread = useOpenIn(owner, item?.kind === "conversation" ? item.threadKey : null, "review");
  const questions = useOpenIn(owner, item?.kind === "conversation" ? item.threadKey : null, "needs-input");
  useEffect(() => loadLeaderNamesOnce(owner), [owner]);
  // A thread whose whole request became a quest's work, or that joined an earlier one, is that
  // conversation now: the pane turns into it in place, once its messages are here to show.
  const becameQuest = useReadyThreadDestination(
    owner,
    useThreadDestinations(owner).get(item?.kind === "conversation" ? item.threadKey.toLowerCase() : ""),
  );
  useEffect(() => {
    if (item && becameQuest)
      replaceSideItem(leaderId, item.id, { kind: "conversation", threadKey: becameQuest, leaderId: owner });
  }, [becameQuest, item, leaderId, owner]);
  const running = useStore((state) =>
    item?.kind === "conversation" ? isLeaderThreadRunning(state, owner, item.threadKey) : false,
  );
  // The status the row's dot shows, by the colors and order of the status groups: a question for
  // the user is amber, unread answers blue, a running thread green.
  const tone: SideTone = questions > 0 ? "question" : unread > 0 ? "unread" : running ? "running" : null;
  return (
    <div
      className={`group flex h-9 shrink-0 items-center gap-2 border-b border-cc-border/70 pl-3 pr-1.5 text-[13px] ${
        open ? "bg-cc-hover/40" : "hover:bg-cc-hover/30"
      }`}
      data-testid="side-item-row"
      data-open={open}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        aria-expanded={open}
      >
        {owner === leaderId ? (
          <SideItemIcon leaderId={leaderId} item={item} tone={tone} />
        ) : (
          <LeaderIcon leaderId={owner} />
        )}
        <span className={`min-w-0 truncate ${open ? "text-cc-fg" : "text-cc-fg/80"}`}>
          <SideItemTitle leaderId={owner} item={item} />
        </span>
        {questions > 0 && (
          // A question waits on the user here: the amber bell that marks questions everywhere else
          // (Needs you rows, the bell list). Jiayi (Oct 31): a "question" label read badly in light.
          <span
            className="inline-flex shrink-0 text-cc-attention"
            title={questions === 1 ? "A question for you" : `${questions} questions for you`}
            aria-label={questions === 1 ? "A question for you" : `${questions} questions for you`}
            data-testid="side-item-questions"
          >
            <BellIcon className="h-3.5 w-3.5" />
          </span>
        )}
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info">
            {unread} new
          </span>
        )}
      </button>
      <ItemActions leaderId={leaderId} item={item} />
    </div>
  );
}

/** The portrait of the leader a side item talks to, when it is not the column's own. */
function LeaderIcon({ leaderId }: { leaderId: string }) {
  const leader = useLeaderCard(leaderId);
  const name = `With #${leader?.sessionNum ?? "?"} ${leader?.name ?? "another leader"}`;
  return (
    <span className="inline-flex shrink-0" title={name} aria-label={name} data-testid="side-item-leader">
      {leader?.leaderProfilePortrait ? (
        <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} />
      ) : (
        <NewThreadIcon className="h-3.5 w-3.5 text-cc-primary" />
      )}
    </span>
  );
}

function ItemActions({ leaderId, item }: { leaderId: string; item: SideItem | null }) {
  if (!item) return null;
  // A conversation moves to the main view, an artifact to the Library; either leaves the column.
  const moveOut =
    item.kind === "conversation"
      ? {
          label: "Open in the main view",
          go: () => navigateToSessionThread(sideItemLeader(leaderId, item), item.threadKey),
        }
      : item.kind === "session"
        ? { label: "Open in the main view", go: () => navigateToSession(item.sessionId) }
        : item.kind === "quest"
          ? { label: "Open the quest", go: () => openQuestOverlayRouteAware(item.questId) }
          : item.kind === "artifact"
            ? { label: "Open in the Library", go: () => openLibraryArtifact(item.artifactId, item.version) }
            : null;
  return (
    <span className="flex shrink-0 items-center">
      {moveOut && (
        <button
          type="button"
          onClick={() => {
            moveOut.go();
            closeSideItem(leaderId, item.id);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          aria-label={moveOut.label}
          title={moveOut.label}
        >
          <OpenInMainIcon />
        </button>
      )}
      <button
        type="button"
        onClick={() => closeSideItem(leaderId, item.id)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-label="Remove from the side column"
        title="Remove from the side column"
        data-testid="side-item-close"
      >
        <SmallX />
      </button>
    </span>
  );
}

function SideItemBody({
  leaderId,
  threadKey,
  item,
  variant,
}: {
  leaderId: string;
  threadKey: string;
  item: SideItem | null;
  variant: "docked" | "sheet";
}): ReactNode {
  if (!item) return <TopicSidePanel leaderId={leaderId} threadKey={threadKey} variant={variant} inColumn />;
  switch (item.kind) {
    case "topic":
      return (
        <TopicSidePanel
          leaderId={leaderId}
          threadKey={threadKey}
          variant={variant}
          inColumn
          pinnedTopicId={item.topicId}
        />
      );
    case "conversation":
      return (
        <SideConversation leaderId={sideItemLeader(leaderId, item)} columnId={leaderId} threadKey={item.threadKey} />
      );
    case "new-chat":
      return (
        <NewSideChat
          columnId={leaderId}
          leaderId={sideItemLeader(leaderId, item)}
          itemId={item.id}
          startedFrom={item.startedFrom}
        />
      );
    case "artifact":
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ArtifactViewer id={item.artifactId} version={item.version} />
        </div>
      );
    case "quest":
      return <SideQuest questId={item.questId} />;
    case "session":
      return <SideSession sessionId={item.sessionId} />;
  }
}

function SideItemTitle({ leaderId, item }: { leaderId: string; item: SideItem | null }) {
  const pinned = useKnownTopicBrief(leaderId, item?.kind === "topic" ? item.topicId : undefined);
  // The section's name: the page under it names its topic.
  if (!item) return <>Topics</>;
  switch (item.kind) {
    case "topic":
      return <>{pinned?.name ?? "Topic"}</>;
    case "conversation":
      return /^q-\d+$/i.test(item.threadKey) ? (
        <>
          <span className="font-mono-code text-[12px] text-cc-muted">{item.threadKey.toLowerCase()}</span>{" "}
          <ThreadOriginName leaderId={leaderId} threadKey={item.threadKey} />
        </>
      ) : (
        <ThreadOriginName leaderId={leaderId} threadKey={item.threadKey} />
      );
    case "new-chat":
      return item.leaderId ? <NewChatWithTitle leaderId={item.leaderId} /> : <>New thread</>;
    case "artifact":
      return <>{item.title ?? "Artifact"}</>;
    case "quest":
      return <SideQuestTitle questId={item.questId} />;
    case "session":
      return <SideSessionTitle sessionId={item.sessionId} />;
  }
}

function NewChatWithTitle({ leaderId }: { leaderId: string }) {
  const leader = useLeaderCard(leaderId);
  return <>New thread with {leader?.name ?? "another leader"}</>;
}

function SideQuestTitle({ questId }: { questId: string }) {
  const quest = useQuestRecord(questId);
  return (
    <>
      <span className="font-mono-code text-[12px] text-cc-muted">{questId}</span> {quest?.title ?? ""}
    </>
  );
}

function SideSessionTitle({ sessionId }: { sessionId: string }) {
  const session = useStore((state) => state.sdkSessions.find((candidate) => candidate.sessionId === sessionId));
  const name = session?.name;
  return (
    <>
      <span className="font-mono-code text-[12px] text-cc-muted">#{session?.sessionNum ?? "?"}</span> {name ?? ""}
    </>
  );
}

/** What a row's status dot shows: a question for the user, unread answers, running work, or none. */
type SideTone = "question" | "unread" | "running" | null;

const TONE_DOT: Record<Exclude<SideTone, null>, string> = {
  question: "bg-[var(--color-cc-phase-accent-amber)]",
  unread: "bg-blue-500",
  running: "bg-emerald-500",
};

function SideItemIcon({ leaderId, item, tone = null }: { leaderId: string; item: SideItem | null; tone?: SideTone }) {
  const key = item?.kind === "conversation" ? item.threadKey.toLowerCase() : "";
  const thread = useKnownThreadOfKey(leaderId, isTopicViewKey(key) ? key : "");
  const quest = useQuestRecord(/^q-\d+$/.test(key) ? key : null);
  const className = "h-3.5 w-3.5 shrink-0";
  if (!item || item.kind === "topic") return <TopicIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "artifact") return <LibraryIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "session") return <SessionIcon className={`${className} text-cc-muted`} />;
  if (item.kind === "quest") return <SideQuestIcon questId={item.questId} />;
  if (item.kind === "new-chat" || (thread && !tone))
    return <NewThreadIcon className={`${className} text-cc-primary`} />;
  if (isTopicViewKey(key) && !thread) return <TopicIcon className={`${className} text-cc-primary`} />;
  // A quest, or a thread with something to show: what waits on the user there or that it runs,
  // else a quest's status color as in the quest lists. An unfinished quest that isn't running is
  // grey, as in the Idle group; a thread with nothing to show keeps its icon.
  const status = quest?.status ?? "in_progress";
  const dot = tone ? TONE_DOT[tone] : status === "in_progress" ? "bg-cc-muted/60" : getQuestStatusTheme(status).dot;
  return (
    <span className={`${className} inline-flex items-center justify-center`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} data-testid="side-item-dot" data-tone={tone ?? "none"} />
    </span>
  );
}

/** Open notifications of a kind (unread answers, questions) in one of the leader's threads. */
function useOpenIn(leaderId: string, threadKey: string | null, category: "review" | "needs-input"): number {
  return useStore((state) =>
    threadKey
      ? (state.sessionNotifications.get(leaderId) ?? []).filter(
          (notification) =>
            notification.category === category &&
            !notification.done &&
            resolveNotificationOwnerThreadKey(notification) === normalizeThreadKey(threadKey),
        ).length
      : 0,
  );
}

/** A quest's status color, as in the quest lists. */
function SideQuestIcon({ questId }: { questId: string }) {
  const quest = useQuestRecord(questId);
  return (
    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span className={`h-2 w-2 rounded-full ${getQuestStatusTheme(quest?.status ?? "in_progress").dot}`} />
    </span>
  );
}

function SessionIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 13.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function OpenInMainIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M9.5 6.5L3 13M3 8.5V13h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 3h5v10H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SmallX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
