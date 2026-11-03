import { Activity, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { holdSessionConnection } from "../../ws.js";
import { useRememberedFolds } from "../../utils/remembered-folds.js";
import { SectionEdge, useSectionHeights } from "../StackedPanes.js";
import { useStore } from "../../store.js";
import {
  closeSideItem,
  HOME_ITEM,
  notePaneClick,
  openInSide,
  isChatItem,
  isConversationItem,
  rememberSideChatHeight,
  setSideOneAtATime,
  newSideChat,
  noteSideItemUsed,
  replaceSideItem,
  unfoldSideItem,
  SIDE_HEIGHTS_STACK,
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
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../../utils/thread-projection.js";
import { isLeaderThreadRunning } from "../../utils/leader-thread-tabs-resolver.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { noteThreadMerged } from "../../utils/thread-viewport.js";
import { useKnownTopicBrief } from "../../utils/leader-topics.js";
import { CollapseIcon, NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { TopicSidePanel } from "../library/TopicSidePanel.js";
import { ThreadOriginName } from "./thread-names.js";
import { useQuestRecord } from "../QuestSummaryCard.js";
import { getQuestLeaderSessionId } from "../../utils/quest-helpers.js";
import { QuestInlineLink } from "../QuestInlineLink.js";
import { THREAD_GROUP_DOT, type ThreadGroupId } from "../ThreadTabGroups.js";
import { SideConversation } from "./SideConversation.js";
import { NewSideChat } from "./NewSideChat.js";
import { SideChatLeaderMenu, useLeaderCard } from "./SideChatLeaders.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { SideQuest } from "./SideQuest.js";
import { SideSession } from "./SideSession.js";
import { SideHome } from "./SideHome.js";
import { SideQuestIcon, useSideQuestOf } from "../SideQuestCue.js";
import { ArtifactViewer } from "../library/ArtifactViewer.js";
import { LibraryIcon } from "../ArtifactInline.js";
import { BellIcon } from "../AttentionKind.js";
import { openLibraryArtifact } from "../../utils/library-nav.js";
import {
  ChatFocusContext,
  chatFocusHandlers,
  focusChat,
  MAIN_CHAT,
  sideChatId,
  useChatFocusMarked,
  useChatFocusStore,
  useSideChat,
} from "../../utils/chat-focus.js";
import { ChatFocusMark } from "../ChatFocusMark.js";
import { useQuestRoundTitle } from "../QuestRoundTitle.js";

/** Items whose page stays mounted (hidden) after another opens, so going back keeps its place. */
const KEPT_MOUNTED = 3;

/** How tall a section's header row is, for the default height of an open section. */
const ROW_HEIGHT = 36;

/**
 * The side column (Logseq's right sidebar), from the top: whatever the user put beside the
 * conversation (threads, other conversations, topic pages, artifacts), newest first, each with its
 * own leader; then the main view's leader's topics, for browsing (the topic page of the thread on
 * screen, else the list). One column for the whole app: what is in it stays when the main view
 * switches leader or session (Jiayi, Nov 1). Each section folds on its own from its header row,
 * any number can be open, and the column scrolls when they don't fit. An open section's bottom edge
 * drags to set its height (Jiayi's choice, Oct 31: like Logseq, the panel scrolls rather than
 * squeezing each section). Folds and heights are remembered in this browser. On a phone it is the
 * same column in a sheet.
 */
export function SideColumn({
  leaderId,
  threadKey,
  variant,
}: {
  /** The main view's leader, whose topics the column ends with; none for a session without a leader. */
  leaderId: string | null;
  /** The thread on screen in the main view: the topic page follows it. */
  threadKey: string;
  variant: "docked" | "sheet";
}) {
  const { items, focus, focusAt, chatHeight, oneAtATime = false } = useSideColumn();
  const folds = useRememberedFolds();
  const isOpen = (id: string) => !folds.isFolded(sideFoldId(id));
  // Unfolding goes through the column's open limit: a fourth open conversation folds the oldest.
  const toggle = (id: string) => (isOpen(id) ? folds.toggle(sideFoldId(id)) : unfoldSideItem(id));
  const heights = useSectionHeights(SIDE_HEIGHTS_STACK);
  const sectionIds = [...items.map((item) => item.id), ...(leaderId ? [HOME_ITEM] : [])];
  const idsKey = sectionIds.join(",");
  useEffect(() => heights.keepOnly(idsKey.split(",")), [idsKey]);
  // A new thread starts as tall as the side conversation last resized (Jiayi, Nov 1): one height
  // doesn't suit everyone, and their last drag says what suits them.
  const seenIds = useRef(new Set(sectionIds));
  useEffect(() => {
    for (const item of items) {
      if (seenIds.current.has(item.id)) continue;
      seenIds.current.add(item.id);
      if (item.kind === "new-chat" && chatHeight !== undefined) heights.set(item.id, chatHeight);
    }
  }, [idsKey]);
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
  const sharedChatFill = Math.max(160, viewport - ROW_HEIGHT);
  // Something just opened in the column scrolls into view (not on mount: the column stays as left).
  const sectionElements = useRef(new Map<string, HTMLElement>());
  const bodyElements = useRef(new Map<string, HTMLElement>());
  const shownFocus = useRef(focusAt);
  useEffect(() => {
    if (!focus || focusAt === shownFocus.current) return;
    shownFocus.current = focusAt;
    sectionElements.current.get(focus)?.scrollIntoView?.({ block: "nearest" });
    // Opening a conversation beside the main view focuses it, as opening a window does.
    const opened = items.find((item) => item.id === focus);
    if (variant === "docked" && opened && isChatItem(opened)) focusChat(sideChatId(focus));
  }, [focus, focusAt]);
  // Open sections stay mounted, and so do the last few folded pages. A folded conversation unmounts:
  // its feed and live messages are what the open limit saves, and it reopens where it was left.
  const conversationIds = new Set(items.filter(isConversationItem).map((item) => item.id));
  const keptRef = useRef<string[]>([]);
  const openIds = sectionIds.filter(isOpen);
  keptRef.current = [...openIds, ...keptRef.current.filter((id) => !openIds.includes(id) && !conversationIds.has(id))]
    .filter((id) => sectionIds.includes(id))
    .slice(0, openIds.length + KEPT_MOUNTED);
  const kept = keptRef.current;
  // Using a pane (focusing it) makes it the last conversation the open limit folds.
  const focusedChat = useChatFocusStore((state) => state.focused);
  useEffect(() => {
    if (focusedChat.startsWith("side:")) noteSideItemUsed(focusedChat.slice("side:".length));
  }, [focusedChat]);
  const close = () => (variant === "sheet" ? setTopicSheetOpen(false) : setTopicPanelOpen(false));
  useEffect(() => {
    if (leaderId) loadLeaderNamesOnce(leaderId);
  }, [leaderId]);
  // The column's conversations read and send over their leaders' connections, which the main view
  // keeps open only for the session it shows. Held per leader, so a new chat turning into its
  // thread keeps the same connection: dropping it in between loses the live messages of its first turn.
  // Only open conversations, new threads and Homes need theirs: a folded one shows nothing live.
  const itemLeaders = [
    ...new Set(
      items.flatMap((item) =>
        (item.kind === "conversation" || item.kind === "new-chat" || item.kind === "home") && isOpen(item.id)
          ? [item.leaderId]
          : [],
      ),
    ),
  ]
    .sort()
    .join(",");
  // A leader still wanted keeps its hold: releasing and taking it again would reconnect it.
  const heldLeaders = useRef(new Map<string, () => void>());
  useEffect(() => {
    const wanted = new Set(itemLeaders ? itemLeaders.split(",") : []);
    const held = heldLeaders.current;
    for (const other of wanted) if (!held.has(other)) held.set(other, holdSessionConnection(other));
    for (const [other, release] of held) {
      if (wanted.has(other)) continue;
      release();
      held.delete(other);
    }
  }, [itemLeaders]);
  useEffect(() => {
    const held = heldLeaders.current;
    return () => {
      for (const release of held.values()) release();
      held.clear();
    };
  }, []);

  /**
   * One section: its header row (sticky while its body scrolls past), then, while open, its body at
   * its height and the edge that sets it. A conversation keeps a fixed height (its feed scrolls
   * inside); a page is as tall as its content, up to that height.
   */
  const section = (
    id: string,
    row: ReactNode,
    body: ReactNode,
    fixed: boolean,
    defaultHeight: number,
    /** A chat's focus id: a conversation's section can be the focused chat (chat-focus.ts). */
    chatId?: string,
  ) => {
    const open = isOpen(id);
    // Chats one at a time share one height: the last a chat was dragged to, else the column's less
    // one header row, so it doesn't shrink as more go in. Others keep their own heights.
    const shared = oneAtATime && fixed;
    const dragged = shared ? chatHeight : heights.heightOf(id);
    const size = dragged ?? (shared ? sharedChatFill : defaultHeight);
    const content = (
      <>
        <div className="sticky top-0 z-10 bg-cc-bg">
          {/* The focused chat's mark, in the header row so it stays in view while the pane scrolls. */}
          <span className="hidden group-data-[chat-focused=true]/chat:block">
            <ChatFocusMark />
          </span>
          {row}
        </div>
        {kept.includes(id) && (
          <Activity mode={open ? "visible" : "hidden"}>
            <div
              ref={(element) => {
                if (element) bodyElements.current.set(id, element);
                else bodyElements.current.delete(id);
              }}
              className="isolate flex min-h-0 overflow-hidden"
              style={fixed || dragged !== undefined ? { height: size } : { maxHeight: size }}
              data-testid="side-section-body"
            >
              {variant === "docked" && <ColumnScrollStrip scrollRef={scrollRef} />}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
            </div>
            <SectionEdge
              measure={() => bodyElements.current.get(id)?.getBoundingClientRect().height || size}
              onResize={(start, delta) => {
                const height = heights.resize(id, start, delta);
                if (fixed) rememberSideChatHeight(height);
              }}
              onReset={() => {
                heights.reset(id);
                // A shared chat height goes back to its default for every chat.
                if (shared) rememberSideChatHeight(undefined);
              }}
            />
          </Activity>
        )}
      </>
    );
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
        {chatId ? (
          <SideChatFocus chatId={chatId} onScreen={open && kept.includes(id)}>
            {content}
          </SideChatFocus>
        ) : (
          content
        )}
      </section>
    );
  };

  const itemSection = (entry: SideItem | null) => {
    const id = entry?.id ?? HOME_ITEM;
    const conversation = !!entry && isChatItem(entry);
    const row = <SideItemRow mainLeaderId={leaderId} item={entry} open={isOpen(id)} onOpen={() => toggle(id)} />;
    const body = (
      // A link clicked here opens in this pane; the open-in-side click opens it in the main view.
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="side-item-body"
        data-item={id}
        // A Home is a switcher for the main view: what is clicked there opens there, not in its pane.
        onClickCapture={(event) => entry?.kind !== "home" && notePaneClick(entry?.id ?? null, event)}
      >
        <SideItemBody mainLeaderId={leaderId} threadKey={threadKey} item={entry} variant={variant} />
      </div>
    );
    // On a phone the sheet is the single view on screen, always focused: its chats use the main
    // view's id. On a desktop each conversation pane is a chat of its own.
    const chatId = !conversation ? undefined : variant === "sheet" ? MAIN_CHAT : sideChatId(id);
    return section(id, row, body, conversation, fill, chatId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="side-column">
      {/* As tall as the strip under the top bar, so their lines meet. */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-cc-border/80 px-2">
        {leaderId && (
          <button
            type="button"
            onClick={() => openInSide(newSideChat(leaderId))}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-cc-primary hover:bg-cc-hover"
            title="Start a thread with the leader about what's on screen"
            data-testid="side-new-chat"
          >
            <NewThreadIcon className="h-4 w-4" />
            New thread
          </button>
        )}
        <SideChatLeaderMenu mainLeaderId={leaderId} />
        <span className="flex-1" />
        <OneAtATimeToggle on={oneAtATime} />
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
        {leaderId && itemSection(null)}
      </div>
    </div>
  );
}

/**
 * Switches chats-one-at-a-time on and off: opening a chat folds the other chats, which share one
 * height. Its icon shows a stack with one open section; it is highlighted while on.
 */
function OneAtATimeToggle({ on }: { on: boolean }) {
  const label = on ? "Chats one at a time: on" : "Chats one at a time";
  return (
    <button
      type="button"
      onClick={() => setSideOneAtATime(!on)}
      aria-pressed={on}
      aria-label="Chats one at a time"
      title={`${label}. When on, opening a chat folds the other chats, and they share one height`}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
        on ? "bg-cc-primary/15 text-cc-primary" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
      data-testid="side-one-at-a-time"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
        <rect x="2.5" y="2" width="11" height="2.5" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
        <rect x="2.5" y="5.75" width="11" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
        <rect x="2.5" y="13" width="11" height="1.5" rx="0.6" fill="currentColor" />
      </svg>
    </button>
  );
}

/** Lines one wheel "line" step moves, in pixels, for wheel events counted in lines. */
const WHEEL_LINE_PX = 16;

/**
 * A narrow strip on the left of a section's content that scrolls the whole column. The column
 * scrolls and so does each conversation in it, and a wheel over a conversation scrolls that
 * conversation; over this strip it scrolls the column (Jiayi, Oct 31). Header rows span the full
 * width: a wheel over them already scrolls the column, and the indent sets a pane's content apart
 * from its title bar. Desktop only: a phone's sheet scrolls by touch.
 */
function ColumnScrollStrip({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      className="group/strip flex w-2.5 shrink-0 items-center justify-center border-r border-cc-border/40 transition-colors hover:bg-cc-hover/60"
      title="Scroll here to move the whole side column"
      aria-hidden="true"
      data-testid="side-scroll-strip"
      onWheel={(event) => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? scroller.clientHeight : 1;
        scroller.scrollBy({ top: event.deltaY * unit });
      }}
    >
      {/* A faint grip, brighter on hover, so the strip can be found without drawing the eye. */}
      <div className="h-8 w-0.5 rounded-full bg-cc-muted/25 transition-colors group-hover/strip:bg-cc-muted/60" />
    </div>
  );
}

/**
 * A side pane as a chat: its id for what it contains (composer, feed), registered while on screen,
 * focused by a click or tap anywhere in it, and marked while it is the focused chat.
 */
function SideChatFocus({ chatId, onScreen, children }: { chatId: string; onScreen: boolean; children: ReactNode }) {
  useSideChat(chatId, onScreen && chatId !== MAIN_CHAT);
  const marked = useChatFocusMarked(chatId) && chatId !== MAIN_CHAT;
  return (
    <ChatFocusContext.Provider value={chatId}>
      <div className="group/chat" data-chat-focused={marked ? "true" : "false"} {...chatFocusHandlers(chatId)}>
        {children}
      </div>
    </ChatFocusContext.Provider>
  );
}

/** One item's header in the stack: its kind, its name, and its actions. */
function SideItemRow({
  mainLeaderId,
  item,
  open,
  onOpen,
}: {
  mainLeaderId: string | null;
  item: SideItem | null;
  open: boolean;
  onOpen: () => void;
}) {
  // A conversation reads as its leader's: its names, unread answers and portrait. A quest's details
  // read as its leader's; the Topics section as the main view's leader's.
  const questLeader = useQuestLeader(item?.kind === "quest" ? item.questId : null);
  const owner = (item ? (sideItemLeader(item) ?? questLeader) : null) ?? mainLeaderId ?? "";
  // The thread whose status the row shows: its conversation, or the quest whose details it shows.
  const statusKey = item?.kind === "conversation" ? item.threadKey : item?.kind === "quest" ? item.questId : null;
  const unread = useOpenIn(owner, statusKey, "review");
  const questions = useOpenIn(owner, statusKey, "needs-input");
  useEffect(() => loadLeaderNamesOnce(owner), [owner]);
  // A thread whose whole request became a quest's work, or that joined an earlier one, is that
  // conversation now: the pane turns into it in place, once its messages are here to show.
  const becameQuest = useReadyThreadDestination(
    owner,
    useThreadDestinations(owner).get(item?.kind === "conversation" ? item.threadKey.toLowerCase() : ""),
  );
  useEffect(() => {
    if (!item || !becameQuest) return;
    // The pane keeps its place in the conversation the thread merged into.
    if (item.kind === "conversation") noteThreadMerged(owner, item.threadKey, becameQuest);
    replaceSideItem(item.id, { kind: "conversation", threadKey: becameQuest, leaderId: owner });
  }, [becameQuest, item, owner]);
  const running = useStore((state) => (statusKey ? isLeaderThreadRunning(state, owner, statusKey) : false));
  // The row's status group, by the status row's rule: a question for the user, then unread
  // answers, then work going on, else Idle. Its dot has that group's color and no other.
  const group: ThreadGroupId =
    questions > 0 ? "needs-input" : unread > 0 ? "new-results" : running ? "in-progress" : "idle";
  return (
    <div
      className={`group flex h-9 shrink-0 items-center gap-2 border-b border-cc-border/70 pl-3 pr-1.5 text-[13px] ${
        open ? "bg-cc-hover/40" : "hover:bg-cc-hover/30"
      }`}
      data-testid="side-item-row"
      data-open={open}
    >
      {/* Not a <button>: the title holds a quest link, and a link may not sit inside a button. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          onOpen();
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-left"
        aria-expanded={open}
      >
        <SideItemIcon leaderId={owner} item={item} group={group} />
        {/* Whose conversation it is (Jiayi, Nov 1): the leader's portrait, as Threads view rows show. */}
        {(item?.kind === "conversation" ||
          item?.kind === "new-chat" ||
          item?.kind === "quest" ||
          item?.kind === "home") && <LeaderIcon leaderId={owner} />}
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
      </div>
      <ItemActions item={item} />
    </div>
  );
}

/** The portrait of the leader a side item's conversation is with, named on hover. */
function LeaderIcon({ leaderId }: { leaderId: string }) {
  const leader = useLeaderCard(leaderId);
  if (!leader?.leaderProfilePortrait) return null;
  const name = `With #${leader.sessionNum ?? "?"} ${leader.name ?? "Leader"}`;
  return (
    <span className="inline-flex shrink-0" title={name} aria-label={name} data-testid="side-item-leader">
      <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} />
    </span>
  );
}

function ItemActions({ item }: { item: SideItem | null }) {
  if (!item) return null;
  // A conversation moves to the main view, an artifact to the Library; either leaves the column.
  const moveOut =
    item.kind === "conversation"
      ? {
          label: "Open in the main view",
          go: () => navigateToSessionThread(item.leaderId, item.threadKey),
        }
      : item.kind === "session"
        ? { label: "Open in the main view", go: () => navigateToSession(item.sessionId) }
        : item.kind === "home"
          ? {
              label: "Open in the main view",
              // Main named outright: a bare leader address restores the thread viewed last, not Home.
              go: () =>
                navigateToSessionThread(item.leaderId, MAIN_THREAD_KEY, false, item.leaderId, {
                  preserveMainThreadRoute: true,
                }),
            }
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
            closeSideItem(item.id);
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
        onClick={() => closeSideItem(item.id)}
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
  mainLeaderId,
  threadKey,
  item,
  variant,
}: {
  mainLeaderId: string | null;
  threadKey: string;
  item: SideItem | null;
  variant: "docked" | "sheet";
}): ReactNode {
  if (!item)
    return mainLeaderId ? (
      <TopicSidePanel leaderId={mainLeaderId} threadKey={threadKey} variant={variant} inColumn />
    ) : null;
  switch (item.kind) {
    case "topic":
      return (
        <TopicSidePanel
          leaderId={item.leaderId}
          // Another leader's topic page doesn't follow the main view's thread.
          threadKey={item.leaderId === mainLeaderId ? threadKey : "main"}
          variant={variant}
          inColumn
          pinnedTopicId={item.topicId}
        />
      );
    case "conversation":
      return <SideConversation leaderId={item.leaderId} threadKey={item.threadKey} />;
    case "new-chat":
      return <NewSideChat item={item} />;
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
    case "home":
      return <SideHome leaderId={item.leaderId} />;
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
        <SideQuestThreadTitle leaderId={leaderId} questId={item.threadKey.toLowerCase()} />
      ) : (
        <ThreadOriginName leaderId={leaderId} threadKey={item.threadKey} />
      );
    case "new-chat":
      return <NewChatWithTitle leaderId={item.leaderId} />;
    case "artifact":
      return <>{item.title ?? "Artifact"}</>;
    case "quest":
      return <SideQuestTitle leaderId={leaderId} questId={item.questId} />;
    case "session":
      return <SideSessionTitle sessionId={item.sessionId} />;
    case "home":
      return <HomeTitle leaderId={item.leaderId} />;
  }
}

function HomeTitle({ leaderId }: { leaderId: string }) {
  const leader = useLeaderCard(leaderId);
  return <>Home{leader?.name ? ` · ${leader.name}` : ""}</>;
}

function NewChatWithTitle({ leaderId }: { leaderId: string }) {
  const leader = useLeaderCard(leaderId);
  return <>New thread with {leader?.name ?? "another leader"}</>;
}

/**
 * A quest's thread: a reopened quest by its newest round first, then the quest muted, cut first. A
 * side quest carries the side-quest mark where the main view's strip has it (Jiayi, Nov 2: side
 * chats show what the main view shows): before the round's title, else after the number.
 */
function SideQuestThreadTitle({ leaderId, questId }: { leaderId: string; questId: string }) {
  const roundTitle = useQuestRoundTitle(questId);
  const sideQuestOf = useSideQuestOf(leaderId, questId);
  const mark = sideQuestOf && <SideQuestMark sideQuestOf={sideQuestOf} />;
  if (!roundTitle) {
    return (
      <>
        <SideQuestNumber questId={questId} /> {mark}
        <ThreadOriginName leaderId={leaderId} threadKey={questId} />
      </>
    );
  }
  return (
    <>
      {mark}
      {roundTitle}{" "}
      <span className="text-cc-muted">
        <SideQuestNumber questId={questId} /> <ThreadOriginName leaderId={leaderId} threadKey={questId} />
      </span>
    </>
  );
}

function SideQuestTitle({ leaderId, questId }: { leaderId: string; questId: string }) {
  const quest = useQuestRecord(questId);
  const sideQuestOf = useSideQuestOf(leaderId, questId);
  return (
    <>
      <SideQuestNumber questId={questId} /> {sideQuestOf && <SideQuestMark sideQuestOf={sideQuestOf} />}
      {quest?.title ?? ""}
    </>
  );
}

/** The side-quest mark inline in a title bar's text, muted as on the main view's strip. */
function SideQuestMark({ sideQuestOf }: { sideQuestOf: string }) {
  return (
    <span className="mr-1 inline-flex align-[-2px] text-cc-muted">
      <SideQuestIcon sideQuestOf={sideQuestOf} />
    </span>
  );
}

/**
 * A row's quest number as a quest link, like the main view's strip: hovering previews the quest, a
 * click opens it, and the open-in-side click shows its details in this column. The click does not
 * also fold the row.
 */
function SideQuestNumber({ questId }: { questId: string }) {
  return (
    <QuestInlineLink
      questId={questId}
      className="cc-quest-link font-mono-code text-[12px] hover:underline"
      stopPropagation
    >
      {questId}
    </QuestInlineLink>
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

function SideItemIcon({
  leaderId,
  item,
  group = "idle",
}: {
  leaderId: string;
  item: SideItem | null;
  group?: ThreadGroupId;
}) {
  const key = item?.kind === "conversation" ? item.threadKey.toLowerCase() : "";
  const thread = useKnownThreadOfKey(leaderId, isTopicViewKey(key) ? key : "");
  const className = "h-3.5 w-3.5 shrink-0";
  if (!item || item.kind === "topic") return <TopicIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "artifact") return <LibraryIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "session") return <SessionIcon className={`${className} text-cc-muted`} />;
  if (item.kind === "home") return <HomeIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "new-chat" || (thread && group === "idle"))
    return <NewThreadIcon className={`${className} text-cc-primary`} />;
  if (isTopicViewKey(key) && !thread) return <TopicIcon className={`${className} text-cc-primary`} />;
  // A quest (its conversation or its details), or a thread with something to show: its status
  // group's dot, the same rule and colors as the status row's. A quest's lifecycle (done, Memory)
  // is not a status here; a finished quest with nothing waiting is Idle.
  return (
    <span className={`${className} inline-flex items-center justify-center`}>
      <span
        className={`h-2 w-2 rounded-full ${THREAD_GROUP_DOT[group]}`}
        data-testid="side-item-dot"
        data-group={group}
      />
    </span>
  );
}

/** The leader a quest belongs to, once its record is here. */
function useQuestLeader(questId: string | null): string | null {
  const quest = useQuestRecord(questId);
  return quest ? getQuestLeaderSessionId(quest) : null;
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

function HomeIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M2.5 7.25 8 2.75l5.5 4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 6.25v6.75h8V6.25" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
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
