import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { createPortal } from "react-dom";
import { useGlobalNeedsInputEntries } from "../hooks/useGlobalNeedsInputEntries.js";
import { useNextAttention, useTrackedNotifyMeEntries } from "../hooks/useNextAttention.js";
import { useStore } from "../store.js";
import { useAttentionThreadTitles, type AttentionThreadTitles } from "../hooks/useAttentionThreadTitles.js";
import { useShallow } from "zustand/react/shallow";
import {
  attentionPlaceIndex,
  buildAttentionBacklog,
  countAttentionPlaces,
  collectThreadReminders,
  type AttentionBacklog,
  type NextAttentionItem,
} from "../utils/next-attention.js";
import { AttentionItemRow, AttentionItemSections } from "./AttentionItemRows.js";
import {
  AttentionKindIcon,
  BellIcon,
  NextChevron,
  attentionKindOf,
  attentionTone,
  type AttentionKind,
} from "./AttentionKind.js";
import { useNotifyMeSummary } from "./NotifyMe.js";
import { ATTENTION_LIST_HASH, ATTENTION_OPEN_EVENT } from "../utils/routing.js";

import { ATTENTION_SECTIONS } from "../utils/next-attention.js";

/** Dispatched by the "Next Item Across Sessions" keyboard shortcut. */
export const ATTENTION_NEXT_EVENT = "takode:attention-next";

/**
 * The top bar's attention list: a count that opens everything across sessions
 * that needs the user, grouped by priority, with a Next step (and keyboard
 * shortcut) that walks the whole list. Below it, collapsed, sit muted prompts,
 * tracked Notify Me threads without a result and threads snoozed with "Remind me
 * later", which Next skips. With only those, the button stays as a quiet bell
 * without a count; with nothing at all it is hidden. `compact` is the phone top bar's larger form.
 */
export function GlobalAttentionMenu({ compact = false }: { compact?: boolean }) {
  const { queue, next, goNext, open: openItem } = useNextAttention();
  const { mutedEntries } = useGlobalNeedsInputEntries();
  const notifyMe = useNotifyMeSummary();
  const [open, setOpen] = useState(false);
  // Pending results are a subset of tracked threads, and already in the queue.
  const waitingTrackedCount = notifyMe.tracked - notifyMe.pending;
  const trackedEntries = useTrackedNotifyMeEntries(open && waitingTrackedCount > 0, notifyMe.signature);
  const reminderSource = useStore(
    useShallow((s) => ({
      sdkSessions: s.sdkSessions,
      syncedProjectionValues: s.syncedProjectionValues,
      syncedProjectionKeys: s.syncedProjectionKeys,
    })),
  );
  const reminders = useMemo(() => collectThreadReminders(reminderSource), [reminderSource]);
  const backlog = useMemo(
    () => buildAttentionBacklog({ muted: mutedEntries, tracked: trackedEntries, reminders }),
    [mutedEntries, trackedEntries, reminders],
  );
  const hasAnything = queue.length > 0 || mutedEntries.length > 0 || waitingTrackedCount > 0 || reminders.length > 0;
  const triggerRef = useRef<HTMLButtonElement>(null);

  // No banner says where a step went: the session and tab it opens show that.
  const step = useCallback(() => {
    goNext();
  }, [goNext]);

  useEffect(() => {
    window.addEventListener(ATTENTION_NEXT_EVENT, step);
    return () => window.removeEventListener(ATTENTION_NEXT_EVENT, step);
  }, [step]);

  // A phone reminder links here (`ATTENTION_LIST_HASH`): a cold start lands on the hash, a running app gets the event.
  useEffect(() => {
    const openList = () => setOpen(true);
    if (window.location.hash === ATTENTION_LIST_HASH) {
      window.history.replaceState(window.history.state, "", "#/");
      openList();
    }
    window.addEventListener(ATTENTION_OPEN_EVENT, openList);
    return () => window.removeEventListener(ATTENTION_OPEN_EVENT, openList);
  }, []);

  // Close once everything is handled, but not while the list is still loading (a reminder can open it at startup).
  const hadAnything = useRef(hasAnything);
  useEffect(() => {
    if (hadAnything.current && !hasAnything) setOpen(false);
    hadAnything.current = hasAnything;
  }, [hasAnything]);

  // While a question is open the pill counts only questions, so amber with a
  // large number never hides that just one needs an answer. The list still has everything.
  const topKind = queue[0] ? attentionKindOf(queue[0]) : undefined;
  // Otherwise it counts places (a topic with three new answers is one), not messages.
  const count =
    topKind === "needs-input"
      ? queue.filter((item) => item.kind === "needs-input").length
      : countAttentionPlaces(queue);

  return (
    <>
      {hasAnything && (
        <AttentionListPill
          ref={triggerRef}
          count={count}
          topKind={topKind}
          compact={compact}
          open={open}
          onClick={() => setOpen((value) => !value)}
        />
      )}
      {open && (
        <GlobalAttentionPanel
          items={queue}
          nextKey={next?.item.key ?? null}
          nextPosition={next ? attentionPlaceIndex(queue, next.item) + 1 : null}
          backlog={backlog}
          trackedCount={waitingTrackedCount}
          trigger={triggerRef.current}
          onClose={() => setOpen(false)}
          onNext={step}
          onOpen={(item) => {
            openItem(item);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * The count button, tinted by the most urgent kind waiting. `count` is the open
 * questions when `topKind` is needs-input, else everything waiting. Without a
 * `topKind` nothing waits, and it is a quiet bell that opens the muted and
 * tracked sections. Separate so the Playground can show its states.
 */
export function AttentionListPill({
  ref,
  count,
  topKind,
  compact = false,
  open = false,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  count: number;
  topKind: AttentionKind | undefined;
  compact?: boolean;
  open?: boolean;
  onClick?: () => void;
}) {
  const tone = topKind ? attentionTone(topKind) : QUIET_TONE;
  const countLabel = topKind === "needs-input" ? `${count} ${count === 1 ? "question" : "questions"} open` : `${count}`;
  const iconClass = compact ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-testid="attention-list-button"
      aria-label={
        topKind ? `Everything that needs attention (${countLabel})` : "Muted questions, tracked tasks and reminders"
      }
      aria-expanded={open}
      title={topKind ? "Everything that needs attention" : "Nothing needs attention"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold transition-colors hover:opacity-90 cursor-pointer ${tone.border} ${tone.bg} ${tone.text} ${
        compact ? "h-9 px-2.5 text-[12px]" : "h-7 px-2 text-[11px]"
      }`}
    >
      {topKind ? (
        <>
          <AttentionKindIcon kind={topKind} className={iconClass} />
          <span className="tabular-nums">{count}</span>
        </>
      ) : (
        <BellIcon className={`${iconClass} shrink-0`} />
      )}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={`${compact ? "h-3.5 w-3.5" : "h-3 w-3"} transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  );
}

/** The list itself. `inline` renders in place for the Playground. */
export function GlobalAttentionPanel({
  items,
  nextKey,
  nextPosition,
  trigger,
  onClose,
  onNext,
  onOpen,
  backlog,
  trackedCount = backlog?.tracked.length ?? 0,
  sessionsOverride,
  threadsOverride,
  inline = false,
}: {
  items: readonly NextAttentionItem[];
  nextKey: string | null;
  nextPosition: number | null;
  backlog?: AttentionBacklog;
  /** Tracked threads without a result; known before their list loads. */
  trackedCount?: number;
  trigger?: HTMLElement | null;
  onClose: () => void;
  onNext: () => void;
  onOpen: (item: NextAttentionItem) => void;
  /** Session numbers and names, and thread titles, for the Playground, which has no real sessions or quests. */
  sessionsOverride?: ReadonlyArray<{ sessionId: string; sessionNum?: number | null; name?: string }>;
  threadsOverride?: AttentionThreadTitles;
  inline?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const titledItems = useMemo(
    () => (backlog ? [...items, ...backlog.muted, ...backlog.reminders] : items),
    [items, backlog],
  );
  const storeThreads = useAttentionThreadTitles(titledItems);
  const sessionInfo = useMemo(() => {
    const info = new Map<string, { tag?: string; label?: string }>();
    for (const { sessionId, sessionNum, name } of sessionsOverride ?? sdkSessions) {
      const tag = sessionNum ? `#${sessionNum}` : undefined;
      info.set(sessionId, { tag, label: [tag, name].filter(Boolean).join(" ") || undefined });
    }
    return info;
  }, [sdkSessions, sessionsOverride]);

  const threads = threadsOverride ?? storeThreads;
  const rowProps: BacklogRowProps = {
    sessionLabelFor: (item) => sessionInfo.get(item.sessionId)?.label,
    sessionTagFor: (item) => sessionInfo.get(item.sessionId)?.tag,
    threads,
  };

  // A row's context menu lives in a portal; using it must not close the list.
  useOutsidePress([panelRef, trigger, "[data-context-menu]"], onClose, !inline);
  useEffect(() => {
    if (inline) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inline, onClose]);

  // Counts are places, as on the pill; Next still steps through every message inside a place.
  const placeCount = countAttentionPlaces(items);
  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Everything that needs attention"
      data-testid="attention-list-panel"
      className={`flex flex-col overflow-hidden rounded-2xl border border-cc-border bg-cc-card/95 shadow-[0_25px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl font-sans-ui ${
        inline
          ? "w-full max-h-[32rem]"
          : "fixed right-3 top-14 z-50 w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(70dvh,36rem)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-cc-border/50 px-3 py-2.5">
        <h2 className="text-[13px] font-medium text-cc-fg">
          Needs attention
          {items.length > 0 && <span className="ml-1 text-[11px] font-normal text-cc-muted">({placeCount})</span>}
        </h2>
        <div className="flex items-center gap-1.5">
          {nextPosition !== null && (
            <button
              type="button"
              onClick={onNext}
              data-testid="attention-list-next"
              aria-label={`Go to the next item that needs attention, ${nextPosition} of ${placeCount}`}
              className="inline-flex items-center gap-1 rounded-full border border-cc-border px-2 py-0.5 text-[11px] font-medium text-cc-fg transition-colors hover:bg-cc-hover cursor-pointer"
            >
              Next
              <span className="tabular-nums text-cc-muted">
                {nextPosition}/{placeCount}
              </span>
              <NextChevron className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 p-1 text-cc-muted transition-colors hover:text-cc-fg cursor-pointer"
            aria-label="Close"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && <p className="px-3 py-3 text-[12px] text-cc-muted">Nothing needs attention.</p>}
        <AttentionItemSections
          items={items}
          kinds={ATTENTION_SECTIONS}
          onOpen={onOpen}
          nextKey={nextKey}
          sessionLabelFor={rowProps.sessionLabelFor}
          sessionTagFor={rowProps.sessionTagFor}
          threads={rowProps.threads}
        />
        {backlog && (
          <>
            <BacklogSection title="Muted questions" items={backlog.muted} onOpen={onOpen} rowProps={rowProps} />
            <BacklogSection
              title="Tracked, no result yet"
              items={backlog.tracked}
              count={trackedCount}
              onOpen={onOpen}
              rowProps={rowProps}
            />
            <BacklogSection title="Snoozed" items={backlog.reminders} onOpen={onOpen} rowProps={rowProps} />
          </>
        )}
      </div>
    </div>
  );
  return inline ? panel : createPortal(panel, document.body);
}

const QUIET_TONE = { text: "text-cc-muted", border: "border-cc-border", bg: "bg-transparent" };

interface BacklogRowProps {
  sessionLabelFor: (item: NextAttentionItem) => string | undefined;
  sessionTagFor: (item: NextAttentionItem) => string | undefined;
  threads: AttentionThreadTitles;
}

/** A collapsed group below the queue. `count` can be known before `items` load. */
function BacklogSection({
  title,
  items,
  count = items.length,
  onOpen,
  rowProps,
}: {
  title: string;
  items: readonly NextAttentionItem[];
  count?: number;
  onOpen: (item: NextAttentionItem) => void;
  rowProps: BacklogRowProps;
}) {
  const [expanded, setExpanded] = useState(false);
  if (count === 0) return null;
  return (
    <section className="border-t border-cc-border/60" aria-label={title}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 bg-cc-hover/20 px-3 py-1.5 text-left cursor-pointer hover:bg-cc-hover/40"
      >
        <NextChevron className={`h-3 w-3 text-cc-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span className="flex-1 text-[11px] font-medium text-cc-muted">{title}</span>
        <span className="text-[10px] text-cc-muted/70">{count}</span>
      </button>
      {expanded &&
        (items.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-cc-muted">Loading…</p>
        ) : (
          <div className="divide-y divide-cc-border/20">
            {items.map((item) => (
              <AttentionItemRow
                key={item.key}
                item={item}
                onOpen={onOpen}
                sessionLabel={rowProps.sessionLabelFor(item)}
                sessionTag={rowProps.sessionTagFor(item)}
                threads={rowProps.threads}
              />
            ))}
          </div>
        ))}
    </section>
  );
}
