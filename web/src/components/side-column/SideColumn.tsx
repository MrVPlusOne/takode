import { Activity, useEffect, useRef, useState, type ReactNode } from "react";
import { setSideViewsOf } from "../../utils/side-views.js";
import { useStore } from "../../store.js";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import {
  closeSideItem,
  HOME_ITEM,
  openInSide,
  openSideItem,
  sideChatOrigin,
  useSideColumn,
  type SideItem,
} from "../../utils/side-column.js";
import { setTopicPanelOpen, setTopicSheetOpen } from "../../utils/topic-panel.js";
import { reloadLeaderThreads, useKnownThreadOfKey, useLeaderThreads } from "../../utils/leader-topics.js";
import { topicApi } from "../../api/topics.js";
import { navigateToSessionThread } from "../../utils/routing.js";
import { resolveNotificationOwnerThreadKey } from "../../utils/notification-thread.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { useKnownTopicBrief } from "../../utils/leader-topics.js";
import { CollapseIcon, NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { TopicSidePanel, useQuestTopic } from "../library/TopicSidePanel.js";
import { ThreadsList } from "../ThreadsMenu.js";
import { ThreadOriginName } from "./thread-names.js";
import { useQuestRecord } from "../QuestSummaryCard.js";
import { getQuestStatusTheme } from "../../utils/quest-status-theme.js";
import { SideConversation } from "./SideConversation.js";
import { NewSideChat } from "./NewSideChat.js";
import { ArtifactViewer } from "../library/ArtifactViewer.js";
import { LibraryIcon } from "../ArtifactInline.js";
import { openLibraryArtifact } from "../../utils/library-nav.js";

/** Items whose page stays mounted (hidden) after another opens, so going back keeps its place. */
const KEPT_MOUNTED = 3;

/**
 * A leader's side column (Logseq's right sidebar): the topic page it follows, plus whatever the user
 * put beside the conversation (side chats, other conversations, topic pages), newest first, as a
 * stack: one item open, filling the column, the others as one-line rows above and below it. On a
 * phone it is the same stack in a sheet.
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
  const { items, open } = useSideColumn(leaderId);
  const entries: Array<SideItem | null> = [...items, null];
  const openId = open === HOME_ITEM || items.some((item) => item.id === open) ? open : HOME_ITEM;
  // Recently open items stay mounted while folded, like kept conversations.
  const keptRef = useRef<string[]>([]);
  keptRef.current = [openId, ...keptRef.current.filter((id) => id !== openId)]
    .filter((id) => id === HOME_ITEM || items.some((item) => item.id === id))
    .slice(0, KEPT_MOUNTED);
  const kept = keptRef.current;
  const close = () => (variant === "sheet" ? setTopicSheetOpen(leaderId, false) : setTopicPanelOpen(leaderId, false));
  // The server sends this browser the live messages of the conversations in the column too.
  const conversationKeys = items
    .flatMap((item) => (item.kind === "conversation" ? [item.threadKey.toLowerCase()] : []))
    .join(",");
  useEffect(() => {
    const owner = {};
    setSideViewsOf(leaderId, owner, conversationKeys ? conversationKeys.split(",") : []);
    return () => setSideViewsOf(leaderId, owner, []);
  }, [conversationKeys, leaderId]);

  const body = (entry: SideItem | null) => {
    const id = entry?.id ?? HOME_ITEM;
    if (!kept.includes(id)) return null;
    return (
      <Activity key={`body:${id}`} mode={id === openId ? "visible" : "hidden"}>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="side-item-body" data-item={id}>
          <SideItemBody leaderId={leaderId} threadKey={threadKey} item={entry} variant={variant} />
        </div>
      </Activity>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="side-column">
      {/* As tall as the strip under the top bar, so their lines meet. */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-cc-border/80 px-2">
        <button
          type="button"
          onClick={() => openInSide(leaderId, { kind: "new-chat", startedFrom: sideChatOrigin(leaderId) })}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-cc-primary hover:bg-cc-hover"
          title="Start a side chat with the leader about what's on screen"
          data-testid="side-new-chat"
        >
          <NewThreadIcon className="h-4 w-4" />
          New side chat
        </button>
        <span className="flex-1" />
        <RecentChats leaderId={leaderId} />
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
      {entries.map((entry) => {
        const id = entry?.id ?? HOME_ITEM;
        return [
          // The topic page alone needs no row of its own: its page starts with its own header.
          items.length > 0 && (
            <SideItemRow
              key={`row:${id}`}
              leaderId={leaderId}
              threadKey={threadKey}
              item={entry}
              open={id === openId}
              onOpen={() => openSideItem(leaderId, id)}
            />
          ),
          body(entry),
        ];
      })}
    </div>
  );
}

/** One item's header in the stack: its kind, its name, and its actions. */
function SideItemRow({
  leaderId,
  threadKey,
  item,
  open,
  onOpen,
}: {
  leaderId: string;
  threadKey: string;
  item: SideItem | null;
  open: boolean;
  onOpen: () => void;
}) {
  const unread = useUnreadIn(leaderId, item?.kind === "conversation" ? item.threadKey : null);
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
        <SideItemIcon leaderId={leaderId} item={item} />
        <span className={`min-w-0 truncate ${open ? "text-cc-fg" : "text-cc-fg/80"}`}>
          <SideItemTitle leaderId={leaderId} threadKey={threadKey} item={item} />
        </span>
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

function ItemActions({ leaderId, item }: { leaderId: string; item: SideItem | null }) {
  if (!item) return null;
  // A conversation moves to the main view, an artifact to the Library; either leaves the column.
  const moveOut =
    item.kind === "conversation"
      ? { label: "Open in the main view", go: () => navigateToSessionThread(leaderId, item.threadKey) }
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

/** The leader's side chats (threads), to open one again in the column. */
function RecentChats({ leaderId }: { leaderId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useOutsidePress([listRef, triggerRef], () => setOpen(false), open);
  const threads = useLeaderThreads(leaderId, open);
  const notifications = useStore((state) => state.sessionNotifications.get(leaderId));
  const count = (category: string, threadKey: string) =>
    (notifications ?? []).filter(
      (notification) =>
        notification.category === category &&
        !notification.done &&
        resolveNotificationOwnerThreadKey(notification) === normalizeThreadKey(threadKey),
    ).length;
  return (
    <span className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12.5px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-expanded={open}
        title="Side chats you had with this leader"
        data-testid="side-recent-chats"
      >
        Recent <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <div
          ref={listRef}
          className="absolute right-0 top-full z-40 mt-1 max-h-[60dvh] w-[22rem] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl"
        >
          <ThreadsList
            menu={{
              threads,
              onOpen: (threadKey) => {
                setOpen(false);
                openInSide(leaderId, { kind: "conversation", threadKey });
              },
              onRemove: (threadKey) => {
                const thread = threads.find((candidate) => candidate.key === threadKey);
                if (!thread) return;
                topicApi
                  .removeThread(thread.id)
                  .catch((error: Error) => console.warn("[side-column] Could not remove the thread:", error.message))
                  .finally(() => reloadLeaderThreads(leaderId));
              },
              unread: (threadKey) => count("review", threadKey),
              questions: (threadKey) => count("needs-input", threadKey),
            }}
            currentKey=""
            writingKey={null}
          />
        </div>
      )}
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
      return <SideConversation leaderId={leaderId} threadKey={item.threadKey} />;
    case "new-chat":
      return <NewSideChat leaderId={leaderId} itemId={item.id} startedFrom={item.startedFrom} />;
    case "artifact":
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ArtifactViewer id={item.artifactId} version={item.version} />
        </div>
      );
  }
}

function SideItemTitle({ leaderId, threadKey, item }: { leaderId: string; threadKey: string; item: SideItem | null }) {
  const followed = useQuestTopic(leaderId, item ? "" : threadKey);
  const pinned = useKnownTopicBrief(leaderId, item?.kind === "topic" ? item.topicId : undefined);
  if (!item) return <>{followed?.name ?? "Topics"}</>;
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
      return <>New side chat</>;
    case "artifact":
      return <>{item.title ?? "Artifact"}</>;
  }
}

function SideItemIcon({ leaderId, item }: { leaderId: string; item: SideItem | null }) {
  const key = item?.kind === "conversation" ? item.threadKey.toLowerCase() : "";
  const thread = useKnownThreadOfKey(leaderId, isTopicViewKey(key) ? key : "");
  const quest = useQuestRecord(/^q-\d+$/.test(key) ? key : null);
  const className = "h-3.5 w-3.5 shrink-0";
  if (!item || item.kind === "topic") return <TopicIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "artifact") return <LibraryIcon className={`${className} text-cc-primary`} />;
  if (item.kind === "new-chat" || thread) return <NewThreadIcon className={`${className} text-cc-primary`} />;
  if (isTopicViewKey(key)) return <TopicIcon className={`${className} text-cc-primary`} />;
  // A quest: its status color, as in the quest lists.
  return (
    <span className={`${className} inline-flex items-center justify-center`}>
      <span className={`h-2 w-2 rounded-full ${getQuestStatusTheme(quest?.status ?? "in_progress").dot}`} />
    </span>
  );
}

/** Unread answers in one of the leader's threads. */
function useUnreadIn(leaderId: string, threadKey: string | null): number {
  return useStore((state) =>
    threadKey
      ? (state.sessionNotifications.get(leaderId) ?? []).filter(
          (notification) =>
            notification.category === "review" &&
            !notification.done &&
            resolveNotificationOwnerThreadKey(notification) === normalizeThreadKey(threadKey),
        ).length
      : 0,
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
