import { useState } from "react";
import type { NextAttentionLanding } from "../hooks/useAttentionNavigator.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../hooks/useLongPress.js";
import { attentionItemMenuItems } from "../utils/attention-item-menu.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import type { AttentionThreadTitles } from "../hooks/useAttentionThreadTitles.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import {
  ATTENTION_GROUP_TITLE,
  AttentionKindIcon,
  NextAttentionToast,
  formatRelativeTime,
  type AttentionKind,
} from "./AttentionKind.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";

const GO_TO_BUTTON_CLASS =
  "inline-flex shrink-0 items-center rounded border border-cc-border/70 bg-cc-card px-2 py-0.5 text-[11px] font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-muted/45 cursor-pointer";

const GROUP_ARIA_LABEL: Record<AttentionKind, string> = {
  "needs-input": "Needs-input prompts",
  "notify-me": "Notify Me results",
  unread: "Unread results",
};

/** Where the feed chip's Next just went, floating above the chip. */
export function SessionAttentionToast({ landing }: { landing: NextAttentionLanding }) {
  return (
    <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 w-max max-w-[min(24rem,calc(100vw-1.5rem))] font-sans-ui">
      <NextAttentionToast landing={landing} inline />
    </div>
  );
}

/** The row's first line: what needs attention. Where it lives goes on the second line. */
function itemLabel(item: NextAttentionItem): string {
  if (item.kind === "unread") return item.threadKey === null ? "Latest result" : item.summary || "New result";
  if (item.kind === "notify-me") return item.entry.pending?.summary || item.label;
  return item.label;
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
}: {
  item: NextAttentionItem;
  onOpen: (item: NextAttentionItem) => void;
  sessionLabel?: string;
  sessionTag?: string;
  threads?: AttentionThreadTitles;
  isNext?: boolean;
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
        data-attention-kind={item.kind}
        data-attention-next={isNext ? "true" : undefined}
      >
        <span className="mt-0.5">
          <AttentionKindIcon kind={item.kind} />
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
 * Items grouped by kind, in queue order: the order the Next steps visit them.
 * `kinds` picks which groups to show (the feed inbox renders its prompts itself).
 */
export function AttentionItemSections({
  items,
  kinds,
  onOpen,
  sessionLabelFor,
  sessionTagFor,
  threads,
  nextKey,
}: {
  items: readonly NextAttentionItem[];
  kinds: readonly AttentionKind[];
  onOpen: (item: NextAttentionItem) => void;
  sessionLabelFor?: (item: NextAttentionItem) => string | undefined;
  sessionTagFor?: (item: NextAttentionItem) => string | undefined;
  threads?: AttentionThreadTitles;
  nextKey?: string | null;
}) {
  return (
    <>
      {kinds.map((kind) => {
        const group = items.filter((item) => item.kind === kind);
        if (group.length === 0) return null;
        return (
          <section
            key={kind}
            className="border-t border-cc-border/60 first:border-t-0"
            aria-label={GROUP_ARIA_LABEL[kind]}
          >
            <div className="flex items-center justify-between bg-cc-hover/20 px-3 py-1.5">
              <span className="text-[11px] font-medium text-cc-muted">{ATTENTION_GROUP_TITLE[kind]}</span>
              <span className="text-[10px] text-cc-muted/70">{group.length}</span>
            </div>
            <div className="divide-y divide-cc-border/20">
              {group.map((item) => (
                <AttentionItemRow
                  key={item.key}
                  item={item}
                  onOpen={onOpen}
                  sessionLabel={sessionLabelFor?.(item)}
                  sessionTag={sessionTagFor?.(item)}
                  threads={threads}
                  isNext={item.key === nextKey}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
