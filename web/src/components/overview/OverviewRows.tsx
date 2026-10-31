import { useState, type ReactNode } from "react";
import type { TopicSummary } from "../../../shared/library-topics.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import type { AttentionThreadTitles } from "../../hooks/useAttentionThreadTitles.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../../hooks/useLongPress.js";
import { attentionItemMenuItems, attentionPlaceMenuItems } from "../../utils/attention-item-menu.js";
import { countNewThings, type NextAttentionItem } from "../../utils/next-attention.js";
import { scopedGetItem, scopedSetItem } from "../../utils/scoped-storage.js";
import { MAIN_THREAD_KEY } from "../../utils/thread-projection.js";
import { firstUnreadItem, attentionItemLabel, ItemIcon } from "../AttentionItemRows.js";
import { AttentionKindIcon, formatRelativeTime } from "../AttentionKind.js";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu.js";
import { TopicIcon } from "../library/library-icons.js";
import type { LeaderOverviewData, RunningQuest } from "./LeaderOverview.js";

/**
 * A question, reminder or tracked result. When it is about a quest, the quest names the row and the
 * item's own words go under it; otherwise its words name it, with the Scribe's note under it.
 */
export function ItemLine({
  item,
  data,
  titles,
  thread,
}: {
  item: NextAttentionItem;
  data: LeaderOverviewData;
  titles: AttentionThreadTitles;
  thread: string;
}) {
  const quest = /^q-\d+$/.test(thread) ? (titles.titleFor(item.sessionId, thread) ?? thread) : null;
  return (
    <Line
      icon={<ItemIcon item={item} />}
      title={quest ?? attentionItemLabel(item)}
      status={item.timestamp > 0 ? <span className="text-cc-muted">{formatRelativeTime(item.timestamp)}</span> : null}
      detail={quest ? attentionItemLabel(item) : data.noteFor(item)}
      onOpen={() => data.open(item)}
      menu={() => attentionItemMenuItems(item)}
      testId="overview-for-you-row"
    />
  );
}

/** A thread's unread answers, reports and finished quest: named by the quest (or topic, or Main). */
export function UnreadLine({
  items,
  data,
  titles,
  thread,
}: {
  items: NextAttentionItem[];
  data: LeaderOverviewData;
  titles: AttentionThreadTitles;
  thread: string;
}) {
  const first = firstUnreadItem(items);
  const name =
    thread === MAIN_THREAD_KEY
      ? "Main"
      : thread
        ? (titles.titleFor(first.sessionId, thread) ?? thread)
        : attentionItemLabel(first);
  return (
    <Line
      icon={
        isTopicViewKey(thread) ? (
          <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
        ) : (
          <AttentionKindIcon kind="unread" />
        )
      }
      title={name}
      status={<span className="text-cc-info">{newCount(items)} new</span>}
      detail={data.noteFor(first)}
      onOpen={() => data.open(first)}
      menu={() => attentionPlaceMenuItems(items, first)}
      testId="overview-for-you-row"
    />
  );
}

/** A quest in progress: its phase's color, title and phase, and the Scribe's note when it wrote one. */
export function RunningLine({ quest, onOpen }: { quest: RunningQuest; onOpen: () => void }) {
  return (
    <Line
      icon={
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: quest.phase?.accent ?? "currentColor" }} />
        </span>
      }
      title={quest.title}
      status={quest.phase ? <span style={{ color: quest.phase.accent }}>{quest.phase.label}</span> : null}
      detail={quest.note}
      onOpen={onOpen}
      testId="overview-running-row"
    />
  );
}

export function TopicLine({ topic, onOpen }: { topic: TopicSummary; onOpen: () => void }) {
  return (
    <Line
      icon={<TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />}
      title={topic.name}
      status={<span className="text-cc-muted">{formatRelativeTime(topic.activityAt)}</span>}
      onOpen={onOpen}
      testId="overview-topic-row"
    />
  );
}

export function OverviewHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-0.5 pt-2.5">
      <h3 className="text-[11px] uppercase tracking-wide text-cc-muted">{title}</h3>
      <span className="text-[11px] tabular-nums text-cc-muted">{count}</span>
    </div>
  );
}

export function OverviewEmpty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-1.5 text-[12.5px] text-cc-muted">{children}</div>;
}

const OPEN_KEY = "cc-overview-open";

/**
 * A list folded behind its heading until opened. Opening it is remembered on this device, for every
 * leader's overview, since what the user wants to see there doesn't depend on the leader.
 */
export function OverviewFold({
  name,
  title,
  count,
  testId,
  children,
}: {
  name: string;
  title: string;
  count: number;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen().includes(name));
  if (count === 0) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    const others = readOpen().filter((other) => other !== name);
    scopedSetItem(OPEN_KEY, JSON.stringify(next ? [...others, name] : others));
  };
  return (
    <section className="border-t border-cc-border/60" data-testid={testId}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-cc-hover"
        data-testid="overview-fold"
      >
        <h3 className="text-[11px] uppercase tracking-wide text-cc-muted">{title}</h3>
        <span className="text-[11px] tabular-nums text-cc-muted">{count}</span>
        <svg
          viewBox="0 0 16 16"
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-cc-muted transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
      {open && children}
    </section>
  );
}

function readOpen(): string[] {
  try {
    const value = JSON.parse(scopedGetItem(OPEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch (error) {
    console.warn("[overview] Ignoring unreadable folded sections:", error);
    return [];
  }
}

/**
 * One row: an icon, what it is on one line and a short status at the right, and at most one more
 * line when it adds something. A tap opens it; a long-press offers the item's actions.
 */
function Line({
  icon,
  title,
  status,
  detail,
  onOpen,
  menu,
  testId,
}: {
  icon: ReactNode;
  title: ReactNode;
  status?: ReactNode;
  detail?: string;
  onOpen: () => void;
  menu?: () => ContextMenuItem[];
  testId: string;
}) {
  const [open, setOpen] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const longPress = useLongPress((x, y) => {
    const items = menu?.() ?? [];
    if (items.length > 0) setOpen({ x, y, items });
  });
  return (
    <>
      <button
        type="button"
        {...(menu ? longPress.handlers : {})}
        style={menu ? longPress.pressStyle : undefined}
        onClick={onOpen}
        className={`flex w-full min-w-0 flex-col px-3 py-2 text-left hover:bg-cc-hover ${menu ? LONG_PRESS_TARGET_CLASS : ""}`}
        data-testid={testId}
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          {icon}
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-cc-fg">{title}</span>
          {status && <span className="shrink-0 text-[12px]">{status}</span>}
        </span>
        {detail && (
          <span className="mt-0.5 block w-full truncate pl-6 text-[12px] text-cc-fg/65" data-testid="overview-note">
            {detail}
          </span>
        )}
      </button>
      {open && <ContextMenu x={open.x} y={open.y} items={open.items} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Answers to one request count once; finished quests count too. */
function newCount(items: readonly NextAttentionItem[]): number {
  const finished = items.filter(
    (item) => item.kind === "unread" && item.notification?.unreadReason === "quest-complete",
  );
  return countNewThings(items.filter((item) => !finished.includes(item))) + finished.length;
}
