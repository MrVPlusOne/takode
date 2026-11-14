import { useShallow } from "zustand/react/shallow";
import { Activity, useEffect, useRef, useState, type ReactNode } from "react";
import { holdSessionConnection } from "../../ws.js";
import { useRememberedFolds } from "../../utils/remembered-folds.js";
import { useStore } from "../../store.js";
import {
  closeSideItem,
  HOME_ITEM,
  notePaneClick,
  openInSide,
  isChatItem,
  isConversationItem,
  newSideChat,
  replaceSideItem,
  selectSideTab,
  unfoldSideItem,
  SIDE_GROUPS,
  sideFoldId,
  sideItemGroup,
  type SideTab,
  sideItemLeader,
  useSideColumn,
  type SideItem,
  isOtherColumnClick,
  useOtherColumnClickLabel,
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
import { CollapseIcon, GalleryIcon, NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { TopicSidePanel } from "../library/TopicSidePanel.js";
import { ThreadOriginName } from "./thread-names.js";
import { useQuestRecord } from "../QuestSummaryCard.js";
import { getQuestLeaderSessionId } from "../../utils/quest-helpers.js";
import { QuestInlineLink } from "../QuestInlineLink.js";
import { THREAD_GROUP_DOT, type ThreadGroupId } from "../ThreadTabGroups.js";
import { SideConversation } from "./SideConversation.js";
import { NewSideChat, newSideChatDraftKey } from "./NewSideChat.js";
import { SideTabs } from "./SideTabs.js";
import { SideChatLeaderMenu, useLeaderCard } from "./SideChatLeaders.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { SideQuest } from "./SideQuest.js";
import { SideSession } from "./SideSession.js";
import { SideHome } from "./SideHome.js";
import { useAttentionCue } from "../../utils/attention-cue.js";
import { SideQuestIcon, useSideQuestOf, type SideQuestOf } from "../SideQuestCue.js";
import { ArtifactViewer } from "../library/ArtifactViewer.js";
import { LibraryIcon } from "../ArtifactInline.js";
import { BellIcon } from "../AttentionKind.js";
import { openLeaderLibrary, openLibraryArtifact } from "../../utils/library-nav.js";
import {
  ChatFocusContext,
  chatFocusHandlers,
  focusChat,
  MAIN_CHAT,
  sideChatId,
  useChatFocusMarked,
  useSideChat,
} from "../../utils/chat-focus.js";
import { ChatFocusMark } from "../ChatFocusMark.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../../hooks/useLongPress.js";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu.js";
import { InlineThreadUpdate } from "../ThreadUpdate.js";
import { useThreadNews } from "../home/HomeExtras.js";

/** Folded pages that stay mounted (hidden), so going back to one keeps its place. */
const KEPT_MOUNTED = 3;

/**
 * The side column (Logseq's right sidebar): what the user put beside the conversation, each item
 * with its own leader, and the main view's leader's topics. One tab fills it at a time (Jiayi's
 * choice, Nov 14): Chats (threads, other conversations), Quests (quest pages) and Pages (artifacts,
 * Homes, pinned topic pages), each newest first and shown while it holds something, then Topic (the
 * topic page of the thread on screen, else the list). A tab lists its items as rows, and the one
 * open item fills what the rows leave, scrolling on its own: the column itself never scrolls. It
 * used to, with its open chat scrolling inside it, and a scrolled column hid the chat's top. One
 * column for the whole app: what is in it stays when the main view switches leader or session
 * (Jiayi, Nov 1). On a phone it is the same column in a sheet.
 */
export function SideColumn({
  leaderId,
  threadKey,
  variant,
}: {
  /** The main view's leader, whose topics the column shows; none for a session without a leader. */
  leaderId: string | null;
  /** The thread on screen in the main view: the topic page follows it. */
  threadKey: string;
  variant: "docked" | "sheet";
}) {
  const { items, tab: chosenTab, focus, focusAt } = useSideColumn();
  const folds = useRememberedFolds();
  const groups = SIDE_GROUPS.map((group) => ({ group, items: items.filter((item) => sideItemGroup(item) === group) }));
  const tabs: SideTab[] = [
    ...groups.filter((entry) => entry.items.length > 0).map((entry) => entry.group),
    ...(leaderId ? (["topic"] as const) : []),
  ];
  const tab = chosenTab && tabs.includes(chosenTab) ? chosenTab : (tabs[0] ?? "topic");
  const tabOfId = new Map<string, SideTab>(items.map((item) => [item.id, sideItemGroup(item)]));
  const isOpen = (id: string) => id === HOME_ITEM || !folds.isFolded(sideFoldId(id));
  // On screen: open, in the tab on screen.
  const isShown = (id: string) => isOpen(id) && (tabOfId.get(id) ?? "topic") === tab;
  // Opening an item folds the others of its tab (`unfoldSideItem`).
  const toggle = (id: string) => (isOpen(id) ? folds.toggle(sideFoldId(id)) : unfoldSideItem(id));
  // Opening a conversation beside the main view focuses it, as opening a window does.
  const shownFocus = useRef(focusAt);
  useEffect(() => {
    if (!focus || focusAt === shownFocus.current) return;
    shownFocus.current = focusAt;
    const opened = items.find((item) => item.id === focus);
    if (variant === "docked" && opened && isChatItem(opened)) focusChat(sideChatId(focus));
  }, [focus, focusAt]);
  // Each tab's open item stays mounted (hidden while another tab is on screen, so switching back is
  // instant and keeps its place), and so do the last few folded pages. A folded conversation
  // unmounts: its feed and live messages are what folding saves, and it reopens where it was left.
  const conversationIds = new Set(items.filter(isConversationItem).map((item) => item.id));
  const openIds = [...items.map((item) => item.id).filter(isOpen), ...(leaderId ? [HOME_ITEM] : [])];
  const keptRef = useRef<string[]>([]);
  keptRef.current = [
    ...openIds,
    ...keptRef.current.filter((id) => !openIds.includes(id) && !conversationIds.has(id) && tabOfId.has(id)),
  ].slice(0, openIds.length + KEPT_MOUNTED);
  const kept = keptRef.current;
  const close = () => (variant === "sheet" ? setTopicSheetOpen(false) : setTopicPanelOpen(false));
  useEffect(() => {
    if (leaderId) loadLeaderNamesOnce(leaderId);
  }, [leaderId]);
  // The column's conversations read and send over their leaders' connections, which the main view
  // keeps open only for the session it shows. Held per leader, so a new chat turning into its
  // thread keeps the same connection: dropping it in between loses the live messages of its first turn.
  // Only conversations, new threads and Homes on screen need theirs: a hidden one shows nothing live.
  const itemLeaders = [
    ...new Set(
      items.flatMap((item) =>
        (item.kind === "conversation" || item.kind === "new-chat" || item.kind === "home") && isShown(item.id)
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
   * One item of a tab: its row (none for the topic page, which is its tab's only content), then,
   * while open, its body filling what the tab's rows leave.
   */
  const itemSection = (entry: SideItem | null) => {
    const id = entry?.id ?? HOME_ITEM;
    const open = isOpen(id);
    const conversation = !!entry && isChatItem(entry);
    // A page (a quest's details, an artifact, a Home, a pinned topic page) gets a page's quiet bar.
    const row = !entry ? null : conversation ? (
      <SideItemRow mainLeaderId={leaderId} item={entry} open={open} onOpen={() => toggle(id)} />
    ) : (
      <PageItemRow item={entry} open={open} onOpen={() => toggle(id)} />
    );
    // On a phone the sheet is the single view on screen, always focused: its chats use the main
    // view's id. On a desktop each conversation pane is a chat of its own.
    const chatId = !conversation ? undefined : variant === "sheet" ? MAIN_CHAT : sideChatId(id);
    const content = (
      <>
        {row && (
          <div className="shrink-0">
            {/* The focused chat's mark, in the header row so it stays in view while the pane scrolls. */}
            <span className="hidden group-data-[chat-focused=true]/chat:block">
              <ChatFocusMark />
            </span>
            {row}
          </div>
        )}
        {kept.includes(id) && (
          <Activity mode={open ? "visible" : "hidden"}>
            {/* A link clicked here opens in this pane; the open-in-side click opens it in the main view. */}
            <div
              className="isolate flex min-h-0 flex-1 flex-col overflow-hidden"
              data-testid="side-item-body"
              data-item={id}
              // A Home is a switcher for the main view: what is clicked there opens there, not in its pane.
              onClickCapture={(event) => entry?.kind !== "home" && notePaneClick(entry?.id ?? null, event)}
            >
              <SideItemBody mainLeaderId={leaderId} threadKey={threadKey} item={entry} variant={variant} />
            </div>
          </Activity>
        )}
      </>
    );
    const sectionClass = `flex min-h-0 flex-col ${open ? "min-h-40 flex-1" : "shrink-0"}`;
    return (
      <section key={id} className={sectionClass} data-section={id} data-open={open} data-testid="side-section">
        {chatId ? (
          <SideChatFocus chatId={chatId} onScreen={isShown(id) && kept.includes(id)} className={sectionClass}>
            {content}
          </SideChatFocus>
        ) : (
          content
        )}
      </section>
    );
  };

  const chats = groups[0]!;
  const panes: { tab: SideTab; content: ReactNode }[] = [
    ...groups
      .filter((entry) => entry.items.length > 0)
      .map(({ group, items: groupItems }) => ({ tab: group as SideTab, content: groupItems.map(itemSection) })),
    ...(leaderId ? [{ tab: "topic" as const, content: itemSection(null) }] : []),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="side-column">
      {/* The column's own row, as tall as the strip under the top bar, so their lines meet. */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-cc-border/80 px-2">
        {leaderId && (
          <button
            type="button"
            onClick={() => {
              // Opens on the Chats tab, at its top, ready to type.
              openInSide(newSideChat(leaderId));
              useStore.getState().focusComposer(newSideChatDraftKey(leaderId), { whenShown: true });
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-cc-primary hover:bg-cc-hover"
            title="Start a thread with the leader about what's on screen"
            aria-label="New thread"
            data-testid="side-new-chat"
          >
            <NewThreadIcon className="h-4 w-4" />
            <span>New thread</span>
          </button>
        )}
        <SideChatLeaderMenu mainLeaderId={leaderId} />
        <span className="flex-1" />
        {/* The same gallery button as the collapsed rail's, so the Library is one click away either way. */}
        {leaderId && (
          <button
            type="button"
            onClick={() => openLeaderLibrary(leaderId)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            aria-label="Open the artifact gallery"
            title="Artifacts"
            data-testid="side-library-button"
          >
            <GalleryIcon className="h-4 w-4" />
          </button>
        )}
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
      {tabs.length > 1 && (
        <ColumnTabs
          tabs={tabs}
          active={tab}
          chats={chats.items}
          counts={Object.fromEntries(groups.map((entry) => [entry.group, entry.items.length]))}
        />
      )}
      {panes.map((pane) => (
        <Activity key={pane.tab} mode={pane.tab === tab ? "visible" : "hidden"}>
          {/* A tab's rows, then its open item filling the rest; rows alone taller than the column scroll. */}
          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
            data-testid="side-tab-panel"
            data-tab={pane.tab}
          >
            {pane.content}
          </div>
        </Activity>
      ))}
    </div>
  );
}

/** The column's tabs, with what waits in the chats for the Chats tab (`SideTabs`). */
function ColumnTabs({
  tabs,
  active,
  chats,
  counts,
}: {
  tabs: SideTab[];
  active: SideTab;
  chats: SideItem[];
  counts: Partial<Record<SideTab, number>>;
}) {
  const attention = useChatsAttention(chats);
  const questionCue = useAttentionCue(attention.questions, attention.questionsAt);
  const unreadCue = useAttentionCue(attention.unread, attention.unreadAt);
  return (
    <SideTabs
      tabs={tabs}
      active={active}
      onSelect={selectSideTab}
      counts={counts}
      chats={{ ...attention, questionCue, unreadCue }}
    />
  );
}

/**
 * What waits in the chats: open questions and unread answers, when each came last, and whether a
 * chat's leader is writing in it.
 */
function useChatsAttention(items: SideItem[]) {
  const keysKey = items
    .flatMap((item) => (item.kind === "conversation" ? [`${item.leaderId}\t${item.threadKey}`] : []))
    .join("\n");
  return useStore(
    useShallow((state) => {
      const result = { questions: 0, questionsAt: 0, unread: 0, unreadAt: 0, running: false };
      for (const key of keysKey ? keysKey.split("\n") : []) {
        const [leaderId = "", threadKey = ""] = key.split("\t");
        for (const notification of state.sessionNotifications.get(leaderId) ?? []) {
          if (notification.done) continue;
          if (resolveNotificationOwnerThreadKey(notification) !== normalizeThreadKey(threadKey)) continue;
          const at = notification.timestamp ?? 0;
          if (notification.category === "needs-input") {
            result.questions++;
            result.questionsAt = Math.max(result.questionsAt, at);
          } else if (notification.category === "review") {
            result.unread++;
            result.unreadAt = Math.max(result.unreadAt, at);
          }
        }
        if (isLeaderThreadRunning(state, leaderId, threadKey)) result.running = true;
      }
      return result;
    }),
  );
}

/**
 * A side pane as a chat: its id for what it contains (composer, feed), registered while on screen,
 * focused by a click or tap anywhere in it, and marked while it is the focused chat.
 */
function SideChatFocus({
  chatId,
  onScreen,
  className,
  children,
}: {
  chatId: string;
  onScreen: boolean;
  /** Its layout in the tab, as its section's. */
  className: string;
  children: ReactNode;
}) {
  useSideChat(chatId, onScreen && chatId !== MAIN_CHAT);
  const marked = useChatFocusMarked(chatId) && chatId !== MAIN_CHAT;
  return (
    <ChatFocusContext.Provider value={chatId}>
      <div
        className={`group/chat ${className}`}
        data-chat-focused={marked ? "true" : "false"}
        {...chatFocusHandlers(chatId)}
      >
        {children}
      </div>
    </ChatFocusContext.Provider>
  );
}

/** A chat's title row in the stack (or the Topics section's): its status, its name, and its actions. */
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
  // A conversation reads as its leader's: its names, unread answers and portrait; the Topics section
  // as the main view's leader's.
  const owner = (item ? sideItemLeader(item) : null) ?? mainLeaderId ?? "";
  // The thread whose status the row shows: its conversation's.
  const statusKey = item?.kind === "conversation" ? item.threadKey : null;
  const unreadIn = useOpenIn(owner, statusKey, "review");
  const questionsIn = useOpenIn(owner, statusKey, "needs-input");
  const unread = unreadIn.count;
  const questions = questionsIn.count;
  // A new question or answer plays a brief cue, so the user sees which one just changed.
  const questionCue = useAttentionCue(questions, questionsIn.newestAt);
  const unreadCue = useAttentionCue(unread, unreadIn.newestAt);
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
  const { longPress, menu } = useRowMenu(item);
  return (
    <>
      <div
        className={`group flex h-9 shrink-0 items-center gap-2 border-b border-cc-border/70 pl-3 pr-1.5 text-[13px] ${LONG_PRESS_TARGET_CLASS} ${
          open ? "bg-cc-hover/40" : "hover:bg-cc-hover/30"
        }`}
        data-testid="side-item-row"
        data-open={open}
        {...longPress.handlers}
        style={longPress.pressStyle}
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
          {(item?.kind === "conversation" || item?.kind === "new-chat") && <LeaderIcon leaderId={owner} />}
          <span className={`min-w-0 truncate ${open ? "text-cc-fg" : "text-cc-fg/80"}`}>
            <SideItemTitle leaderId={owner} item={item} />
          </span>
          {questions > 0 && (
            // A question waits on the user here: the amber bell that marks questions everywhere else
            // (Needs you rows, the bell list). Jiayi (Oct 31): a "question" label read badly in light.
            <span
              key={`bell:${questionCue}`}
              className="cc-cue-bell inline-flex shrink-0 text-cc-attention"
              data-cue={questionCue > 0 ? "" : undefined}
              title={questions === 1 ? "A question for you" : `${questions} questions for you`}
              aria-label={questions === 1 ? "A question for you" : `${questions} questions for you`}
              data-testid="side-item-questions"
            >
              <BellIcon className="h-3.5 w-3.5" />
            </span>
          )}
          {unread > 0 && (
            <span
              key={`unread:${unreadCue}`}
              className="cc-cue-pill shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info"
              data-cue={unreadCue > 0 ? "" : undefined}
              data-testid="side-item-unread"
            >
              {unread} new
            </span>
          )}
        </div>
        <ItemActions item={item} />
      </div>
      {menu}
    </>
  );
}

/**
 * A page's bar in the stack (a quest's details, an artifact, a Home, a pinned topic page): quieter
 * and slimmer than a chat's title row, with no status or portrait, since the page under it carries
 * its own title and status (Jiayi, Nov 6: pages were framed like chats). Open, it names only the
 * kind of page (a quest by its number); folded, it adds the page's name. Like a chat's row, it folds
 * the page and has its move-out action and the ×.
 */
function PageItemRow({ item, open, onOpen }: { item: SideItem; open: boolean; onOpen: () => void }) {
  const { longPress, menu } = useRowMenu(item);
  return (
    <>
      <div
        className={`flex h-8 shrink-0 items-center gap-2 border-b border-cc-border/50 pl-3 pr-1.5 text-[12px] text-cc-muted ${LONG_PRESS_TARGET_CLASS} ${
          open ? "" : "hover:bg-cc-hover/30"
        }`}
        data-testid="side-page-row"
        data-open={open}
        {...longPress.handlers}
        style={longPress.pressStyle}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            onOpen();
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-left hover:text-cc-fg"
          aria-expanded={open}
          title={open ? "Fold this page" : "Show this page"}
        >
          <PageIcon item={item} />
          <span className="min-w-0 truncate">
            <PageName item={item} full={!open} />
          </span>
        </div>
        <ItemActions item={item} />
      </div>
      {menu}
    </>
  );
}

/** A page's name: its kind (a quest by its number), and with `full` its title too. */
function PageName({ item, full }: { item: SideItem; full: boolean }) {
  switch (item.kind) {
    case "quest":
      return (
        <>
          <span className="font-mono-code">{item.questId}</span>
          {full && (
            <span className="text-cc-fg/80">
              {" "}
              <QuestTitle questId={item.questId} />
            </span>
          )}
        </>
      );
    case "artifact":
      return full ? <span className="text-cc-fg/80">{item.title ?? "Artifact"}</span> : <>Artifact</>;
    case "topic":
      return full ? <PinnedTopicName leaderId={item.leaderId} topicId={item.topicId} /> : <>Topic</>;
    case "home":
      return <HomeTitle leaderId={item.leaderId} />;
    default:
      // Chats have title rows of their own.
      return null;
  }
}

function QuestTitle({ questId }: { questId: string }) {
  return <>{useQuestRecord(questId)?.title ?? ""}</>;
}

function PinnedTopicName({ leaderId, topicId }: { leaderId: string; topicId: string }) {
  const topic = useKnownTopicBrief(leaderId, topicId);
  return <span className="text-cc-fg/80">{topic?.name ?? "Topic"}</span>;
}

function PageIcon({ item }: { item: SideItem }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (item.kind === "artifact") return <LibraryIcon className={className} />;
  if (item.kind === "topic") return <TopicIcon className={className} />;
  if (item.kind === "home") return <HomeIcon className={className} />;
  return <QuestPageIcon className={className} />;
}

/** A row's right-click (or long-press on touch) menu: its own buttons, named. */
function useRowMenu(item: SideItem | null) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const longPress = useLongPress(item ? (x, y) => setAt({ x, y }) : undefined);
  const items = (): ContextMenuItem[] => {
    if (!item) return [];
    const moveOut = sideItemMoveOut(item);
    return [
      ...(moveOut ? [{ label: moveOut.label, onClick: () => moveOut.go(false) }] : []),
      { label: "Remove from the side column", onClick: () => closeSideItem(item.id) },
    ];
  };
  // Outside the row, so presses in the menu do not reach its gestures.
  const menu = at ? <ContextMenu x={at.x} y={at.y} items={items()} onClose={() => setAt(null)} /> : null;
  return { longPress, menu };
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

/**
 * Where an item moves out of the column, and how: a conversation to the main view, an artifact to
 * the Library; it then leaves the column, unless `go` is asked to keep it (the other-column click,
 * Shift by default), so the same chat can be read at two places at once. None for items that stay (new chats, topics).
 */
function sideItemMoveOut(item: SideItem): { label: string; go: (keepHere: boolean) => void } | null {
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
  return moveOut
    ? {
        label: moveOut.label,
        go: (keepHere: boolean) => {
          moveOut.go();
          if (!keepHere) closeSideItem(item.id);
        },
      }
    : null;
}

function ItemActions({ item }: { item: SideItem | null }) {
  const otherColumnClick = useOtherColumnClickLabel();
  if (!item) return null;
  const moveOut = sideItemMoveOut(item);
  return (
    <span className="flex shrink-0 items-center">
      {moveOut && (
        <button
          type="button"
          onClick={(event) => moveOut.go(isOtherColumnClick(event))}
          className="flex h-7 w-7 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          aria-label={moveOut.label}
          title={`${moveOut.label} (${otherColumnClick} to keep it in both columns)`}
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

/** A chat's title, or the Topics section's name (the page under it names its topic). */
function SideItemTitle({ leaderId, item }: { leaderId: string; item: SideItem | null }) {
  if (!item) return <>Topics</>;
  switch (item.kind) {
    case "conversation":
      return <SideConversationTitle leaderId={leaderId} threadKey={item.threadKey} />;
    case "new-chat":
      return <NewChatWithTitle leaderId={item.leaderId} />;
    case "session":
      return <SideSessionTitle sessionId={item.sessionId} />;
    default:
      // Pages have bars of their own (`PageItemRow`).
      return null;
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
 * A conversation's title bar: its one title (a quest's number and title, or the thread's name),
 * then its update, what its newest result is about, which gives way first.
 */
function SideConversationTitle({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  const quest = /^q-\d+$/i.test(threadKey);
  const news = useThreadNews(leaderId, threadKey);
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="min-w-0 shrink truncate">
        {quest ? (
          <SideQuestThreadTitle leaderId={leaderId} questId={threadKey.toLowerCase()} />
        ) : (
          <ThreadOriginName leaderId={leaderId} threadKey={threadKey} />
        )}
      </span>
      <InlineThreadUpdate text={news} />
    </span>
  );
}

/**
 * A quest's thread: its number and title. A side quest carries the side-quest mark where the main
 * view's strip has it (Jiayi, Nov 2: side chats show what the main view shows), after the number.
 */
function SideQuestThreadTitle({ leaderId, questId }: { leaderId: string; questId: string }) {
  const sideQuestOf = useSideQuestOf(leaderId, questId);
  return (
    <>
      <SideQuestNumber questId={questId} /> {sideQuestOf && <SideQuestMark sideQuestOf={sideQuestOf} />}
      <ThreadOriginName leaderId={leaderId} threadKey={questId} />
    </>
  );
}

/** The side-quest mark inline in a title bar's text, muted as on the main view's strip. */
function SideQuestMark({ sideQuestOf }: { sideQuestOf: SideQuestOf }) {
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
  // The Topics section (pages have `PageIcon`).
  if (!item || !isChatItem(item)) return <TopicIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "session") return <SessionIcon className={`${className} text-cc-muted`} />;
  if (item.kind === "new-chat") return <NewThreadIcon className={`${className} text-cc-primary`} />;
  if (isTopicViewKey(key) && !thread) return <TopicIcon className={`${className} text-cc-primary`} />;
  // A quest's conversation or a thread: its status group's dot, the same rule and colors as the
  // status row's. An idle thread is grey like an idle quest, not the thread icon, which said nothing
  // of its state (Jiayi, Nov 10). A quest's lifecycle (done, Memory) is not a status here; a
  // finished quest with nothing waiting is Idle.
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

/** Open notifications of a kind (unread answers, questions) in one of the leader's threads. */
function useOpenIn(
  leaderId: string,
  threadKey: string | null,
  category: "review" | "needs-input",
): { count: number; newestAt: number } {
  return useStore(
    useShallow((state) => {
      if (!threadKey) return { count: 0, newestAt: 0 };
      const open = (state.sessionNotifications.get(leaderId) ?? []).filter(
        (notification) =>
          notification.category === category &&
          !notification.done &&
          resolveNotificationOwnerThreadKey(notification) === normalizeThreadKey(threadKey),
      );
      return { count: open.length, newestAt: Math.max(0, ...open.map((notification) => notification.timestamp ?? 0)) };
    }),
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

/** A quest's details page: a page with a check, for the work it describes. */
function QuestPageIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 2.5h5.5L12 5v8.5H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path
        d="M6 9l1.5 1.5L10 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
