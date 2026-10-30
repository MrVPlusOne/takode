import { useState } from "react";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../hooks/useLongPress.js";
import { attentionItemMenuItems, attentionPlaceMenuItems } from "../utils/attention-item-menu.js";
import {
  attentionPlaceKey,
  attentionSection,
  countNewThings,
  type AttentionSection,
  type NextAttentionItem,
} from "../utils/next-attention.js";
import { firstUnreadResult } from "../utils/notification-navigation.js";
import type { AttentionThreadTitles } from "../hooks/useAttentionThreadTitles.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import {
  ATTENTION_SECTION_TITLE,
  AttentionKindIcon,
  BellIcon,
  attentionKindOf,
  formatRelativeTime,
} from "./AttentionKind.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { NotifyMeIcon } from "./NotifyMe.js";
import { ClockIcon, formatSnoozeUntil } from "./RemindLaterChoices.js";
import { TopicIcon } from "./library/library-icons.js";

const GO_TO_BUTTON_CLASS =
  "inline-flex shrink-0 items-center rounded border border-cc-border/70 bg-cc-card px-2 py-0.5 text-[11px] font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-muted/45 cursor-pointer";

const GROUP_ARIA_LABEL: Record<AttentionSection, string> = {
  "needs-input": "Questions for you",
  urgent: "Urgent results",
  reminder: "Reminders that came due",
  "notify-me": "Notify Me results",
  unread: "Unread results",
};

/**
 * The row's first line: what needs attention. Where it lives goes on the second
 * line. A tracked thread without a result has nothing new to say, so its first
 * line is its title, which the second line then leaves out.
 */
function itemLabel(item: NextAttentionItem): string {
  if (item.kind === "unread" && item.remindAt !== undefined) return `Reminder ${formatSnoozeUntil(item.remindAt)}`;
  if (item.kind === "unread" && item.notification) return unreadMessageLabel(item.summary);
  if (item.kind === "unread") return item.threadKey === null ? "Latest result" : item.summary || "New result";
  // The second line names the thread a reminder brings back.
  if (item.kind === "notify-me" && item.entry.pending?.reminder) return "Reminder";
  if (item.kind === "notify-me") return item.entry.pending?.summary || withoutQuestId(item.label, item.threadKey ?? "");
  return item.label;
}

/**
 * One unread message's words, without the thread its summary starts with ("Answer in q-12 | ",
 * "Thread ready: q-12 | "): the row's second line names the thread already.
 */
export function unreadMessageLabel(summary: string | undefined): string {
  const text = (summary ?? "").trim();
  const words = text
    .replace(/^(?:Answer|Report) in [^|]+\|\s*/i, "")
    .replace(/^Thread ready: [^|]+\|\s*/i, "")
    .replace(/^q-\d+ ready for review:\s*/i, "Finished: ");
  return words || text || "New result";
}

/** Muted prompts and tracked threads without a result take quiet icons, so they never read as waiting. */
function ItemIcon({ item }: { item: NextAttentionItem }) {
  if (item.kind === "unread" && item.remindAt !== undefined)
    return (
      <span className="inline-flex text-cc-muted">
        <ClockIcon />
      </span>
    );
  if (item.kind === "needs-input" && item.entry.notification.muted)
    return <BellIcon className="h-3.5 w-3.5 shrink-0 text-cc-muted" />;
  if (item.kind === "notify-me" && !item.entry.pending) return <NotifyMeIcon className="h-3.5 w-3.5" />;
  return <AttentionKindIcon kind={attentionKindOf(item)} />;
}

/**
 * The thread tab an item belongs to, for its second line: "q-12" with the
 * tab's title, or "Main". Null for session-level items and for sessions
 * without thread tabs, whose second line names the session instead. A tab
 * title stays put while the leader moves on to other quests.
 */
export function attentionThreadPlace(
  item: NextAttentionItem,
  threads?: AttentionThreadTitles,
): AttentionThreadPlace | null {
  const key = item.threadKey?.trim().toLowerCase();
  if (!key) return null;
  if (key === MAIN_THREAD_KEY) return threads?.hasThreadTabs(item.sessionId) ? { thread: "Main", title: "" } : null;
  if (item.kind === "notify-me" && !item.entry.pending) return { thread: key, title: "" };
  // A topic conversation or user thread has no short ID worth showing: it reads by its name alone.
  if (isTopicViewKey(key)) return { thread: threads?.titleFor(item.sessionId, key) ?? "Thread", title: "" };
  const fallback =
    item.kind === "notify-me" ? withoutQuestId(item.entry.title, key) : item.kind === "unread" ? item.label : "";
  return { thread: key, title: threads?.titleFor(item.sessionId, key) ?? fallback };
}

export interface AttentionThreadPlace {
  thread: string;
  title: string;
}

function withoutQuestId(title: string, questId: string): string {
  const trimmed = title.trim();
  return trimmed.toLowerCase().startsWith(`${questId} `) ? trimmed.slice(questId.length).trim() : trimmed;
}

/**
 * One item in an attention list: what it is, where it lives and a Go to, its
 * only inline action. Right-click or long-press opens the actions that fit its
 * kind (see `attentionItemMenuItems`).
 * The second line names the thread tab it belongs to ("q-12 Title · #2851 ·
 * 5m ago", or "Main · #2851 · …"), and `sessionLabel` for session-level items
 * without a thread. `sessionTag` is the short session reference kept beside a
 * thread; lists inside one session leave both out. `isNext` marks the item the
 * list's Next step opens.
 */
export function AttentionItemRow({
  item,
  onOpen,
  sessionLabel,
  sessionTag,
  threads,
  isNext = false,
  note,
}: {
  item: NextAttentionItem;
  onOpen: (item: NextAttentionItem) => void;
  sessionLabel?: string;
  sessionTag?: string;
  threads?: AttentionThreadTitles;
  isNext?: boolean;
  /** A one-line note on it, such as why it matters now (the Scribe's, in a leader's overview). */
  note?: string;
}) {
  const label = itemLabel(item);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const longPress = useLongPress((x, y) => {
    // Built when opened, so actions reflect the current state (such as which session is on screen).
    const items = attentionItemMenuItems(item);
    if (items.length > 0) setMenu({ x, y, items });
  });
  return (
    <>
      <div
        {...longPress.handlers}
        style={longPress.pressStyle}
        className={`flex items-start gap-2 px-3 py-2 ${LONG_PRESS_TARGET_CLASS} ${isNext ? "bg-cc-hover/30" : ""}`}
        data-testid="attention-item-row"
        data-attention-kind={attentionKindOf(item)}
        data-attention-next={isNext ? "true" : undefined}
      >
        <span className="mt-0.5">
          <ItemIcon item={item} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg/90">{label}</span>
            {isNext && (
              <span className="shrink-0 rounded border border-cc-border/70 px-1 py-px text-[10px] font-medium text-cc-muted">
                Next
              </span>
            )}
            <button
              type="button"
              onClick={() => onOpen(item)}
              className={GO_TO_BUTTON_CLASS}
              aria-label={`Go to ${label}`}
            >
              Go to
            </button>
          </div>
          <AttentionItemPlace
            place={attentionThreadPlace(item, threads)}
            sessionLabel={sessionLabel}
            sessionTag={sessionTag}
            timestamp={item.timestamp}
          />
          {note && <AttentionNote note={note} />}
        </div>
      </div>
      {/* Outside the row, so taps and right-clicks in the menu do not reach the row's gesture handlers. */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

/** The row's second line: thread tab (or session) first, then the short session tag and age, which never truncate. */
export function AttentionItemPlace({
  place,
  sessionLabel,
  sessionTag,
  timestamp,
}: {
  place: AttentionThreadPlace | null;
  sessionLabel?: string;
  sessionTag?: string;
  timestamp: number;
}) {
  const tail = [place ? sessionTag : null, timestamp > 0 ? formatRelativeTime(timestamp) : null].filter(Boolean);
  const lead = place ? null : sessionLabel;
  return (
    <p
      className="mt-0.5 flex min-w-0 items-baseline gap-1 text-[10px] text-cc-muted"
      data-testid="attention-item-place"
    >
      {place ? (
        <span className="min-w-0 truncate">
          <span className="font-medium text-cc-fg/70">{place.thread}</span>
          {place.title && <span> {place.title}</span>}
        </span>
      ) : (
        lead && <span className="min-w-0 truncate">{lead}</span>
      )}
      {tail.length > 0 && (
        <span className="shrink-0">
          {place || lead ? "· " : ""}
          {tail.join(" · ")}
        </span>
      )}
    </p>
  );
}

/**
 * Items grouped by section, in queue order: the order the Next steps visit them. Unread answers
 * are grouped by their Library topic under a small heading. `kinds` picks which sections to show
 * (the feed inbox renders its prompts itself).
 */
export function AttentionItemSections({
  items,
  kinds,
  onOpen,
  sessionLabelFor,
  sessionTagFor,
  threads,
  nextKey,
  noteFor,
}: {
  items: readonly NextAttentionItem[];
  kinds: readonly AttentionSection[];
  onOpen: (item: NextAttentionItem) => void;
  sessionLabelFor?: (item: NextAttentionItem) => string | undefined;
  sessionTagFor?: (item: NextAttentionItem) => string | undefined;
  threads?: AttentionThreadTitles;
  nextKey?: string | null;
  /** A one-line note per item (a place takes its first item's). */
  noteFor?: (item: NextAttentionItem) => string | undefined;
}) {
  const row = (item: NextAttentionItem) => (
    <AttentionItemRow
      key={item.key}
      item={item}
      onOpen={onOpen}
      sessionLabel={sessionLabelFor?.(item)}
      sessionTag={sessionTagFor?.(item)}
      threads={threads}
      isNext={item.key === nextKey}
      note={noteFor?.(item)}
    />
  );
  return (
    <>
      {kinds.map((kind) => {
        const group = items.filter((item) => attentionSection(item) === kind);
        if (group.length === 0) return null;
        return (
          <section
            key={kind}
            className="border-t border-cc-border/60 first:border-t-0"
            aria-label={GROUP_ARIA_LABEL[kind]}
            data-attention-section={kind}
          >
            <div className="flex items-center justify-between bg-cc-hover/20 px-3 py-1.5">
              <span className="text-[11px] font-medium text-cc-muted">{ATTENTION_SECTION_TITLE[kind]}</span>
              <span className="text-[10px] text-cc-muted/70">
                {kind === "unread" ? byPlace(group).length : group.length}
              </span>
            </div>
            <div className="divide-y divide-cc-border/20">
              {kind === "unread"
                ? byPlace(group).map((place) => (
                    <AttentionPlaceRow
                      key={place.key}
                      items={place.items}
                      onOpen={onOpen}
                      sessionTag={sessionTagFor?.(place.items[0]!)}
                      sessionLabel={sessionLabelFor?.(place.items[0]!)}
                      threads={threads}
                      isNext={place.items.some((item) => item.key === nextKey)}
                      note={noteFor?.(place.items[0]!)}
                    />
                  ))
                : group.map(row)}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Unread items split into their places (queue order already keeps a place together). */
function byPlace(items: readonly NextAttentionItem[]) {
  const places: Array<{ key: string; items: NextAttentionItem[] }> = [];
  for (const item of items) {
    const key = attentionPlaceKey(item);
    const last = places.at(-1);
    if (last?.key === key) last.items.push(item);
    else places.push({ key, items: [item] });
  }
  return places;
}

/**
 * One place with new things in the attention list: a topic (or a quest or Main outside topics)
 * and how many new answers it holds ("3 new answers", answers to one request counted once).
 * Go to opens its first unread; the menu marks it all read or brings it back later.
 */
function AttentionPlaceRow({
  items,
  onOpen,
  sessionLabel,
  sessionTag,
  threads,
  isNext,
  note,
}: {
  items: readonly NextAttentionItem[];
  onOpen: (item: NextAttentionItem) => void;
  sessionLabel?: string;
  sessionTag?: string;
  threads?: AttentionThreadTitles;
  isNext: boolean;
  note?: string;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const first = firstUnreadItem(items);
  const newest = items.reduce((latest, item) => (item.timestamp > latest.timestamp ? item : latest), items[0]!);
  const topic = first.kind === "unread" ? first.topic : null;
  const threadPlace = attentionThreadPlace(first, threads);
  const name =
    topic?.name ??
    (threadPlace
      ? `${threadPlace.thread}${threadPlace.title ? ` ${threadPlace.title}` : ""}`
      : (sessionLabel ?? "Latest result"));
  const longPress = useLongPress((x, y) => {
    const menuItems = attentionPlaceMenuItems(items, first);
    if (menuItems.length > 0) setMenu({ x, y, items: menuItems });
  });
  return (
    <>
      <div
        {...longPress.handlers}
        style={longPress.pressStyle}
        className={`flex items-start gap-2 px-3 py-2 ${LONG_PRESS_TARGET_CLASS} ${isNext ? "bg-cc-hover/30" : ""}`}
        data-testid="attention-place-row"
        data-attention-kind="unread"
        data-attention-next={isNext ? "true" : undefined}
      >
        <span className="mt-0.5">
          {topic ? <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" /> : <AttentionKindIcon kind="unread" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg/90">{name}</span>
            {isNext && (
              <span className="shrink-0 rounded border border-cc-border/70 px-1 py-px text-[10px] font-medium text-cc-muted">
                Next
              </span>
            )}
            <button
              type="button"
              onClick={() => onOpen(first)}
              className={GO_TO_BUTTON_CLASS}
              aria-label={`Go to ${name}`}
            >
              Go to
            </button>
          </div>
          <p
            className="mt-0.5 flex min-w-0 items-baseline gap-1 text-[10px] text-cc-muted"
            data-testid="attention-place-summary"
          >
            <span className="shrink-0 text-cc-info">{newThingsText(items)}</span>
            <span className="min-w-0 truncate">· {itemLabel(newest)}</span>
            <span className="shrink-0">
              {[sessionTag, newest.timestamp > 0 ? formatRelativeTime(newest.timestamp) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          {note && <AttentionNote note={note} />}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

/** A row's one-line note, under its place line. */
function AttentionNote({ note }: { note: string }) {
  return (
    <p className="mt-0.5 truncate text-[11.5px] text-cc-fg/75" title={note} data-testid="attention-note">
      {note}
    </p>
  );
}

/** "3 new answers", "1 new answer, 1 finished": answers to one request count once. */
export function newThingsText(items: readonly NextAttentionItem[]): string {
  const finished = items.filter(
    (item) => item.kind === "unread" && item.notification?.unreadReason === "quest-complete",
  );
  const rest = items.filter((item) => !finished.includes(item));
  const answers = countNewThings(rest);
  const parts = [
    answers ? `${answers} new ${answers === 1 ? "answer" : "answers"}` : null,
    finished.length ? `${finished.length} finished` : null,
  ];
  return parts.filter(Boolean).join(", ");
}

/** The place's first unread, where opening it lands: answers and reports oldest first, then finished quests. */
function firstUnreadItem(items: readonly NextAttentionItem[]): NextAttentionItem {
  const withNotification = items.filter((item) => item.kind === "unread" && item.notification);
  const notifications = withNotification.flatMap((item) =>
    item.kind === "unread" && item.notification ? [item.notification] : [],
  );
  const first = firstUnreadResult(notifications, () => true);
  return withNotification.find((item) => item.kind === "unread" && item.notification === first) ?? items[0]!;
}
