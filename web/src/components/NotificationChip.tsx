import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import {
  isActionableSessionNotification,
  isClearedNotificationStatus,
  type NotificationStatusSnapshot,
} from "../notification-status.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import { useSessionAttention, type SessionAttentionPreview } from "../hooks/useSessionAttention.js";
import { useAttentionTopicOf, useTrackedNotifyMeEntries } from "../hooks/useNextAttention.js";
import {
  attentionPlaceIndex,
  buildAttentionBacklog,
  collectThreadReminders,
  countAttentionPlaces,
  type NextAttentionItem,
} from "../utils/next-attention.js";
import {
  ATTENTION_KIND_TITLE,
  AttentionKindIcon,
  NextChevron,
  attentionKindOf,
  attentionTone,
} from "./AttentionKind.js";
import { AttentionListPanel } from "./GlobalAttentionMenu.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../hooks/useLongPress.js";

const EMPTY: SessionNotification[] = [];
type NotificationCategory = SessionNotification["category"];
/** The list's widest and tallest, as the top bar's; inside a narrow feed it takes what fits. */
const LIST_MAX_WIDTH_PX = 448;
const LIST_MAX_HEIGHT_PX = 576;
/** Between the chip and the list, and between the list and the feed's edges. */
const LIST_GAP_PX = 8;

function useNotifications(sessionId: string) {
  const all = useStore((s) => s.sessionNotifications?.get(sessionId)) ?? EMPTY;
  const open = useMemo(
    () => all.filter((n) => isActionableSessionNotification(n) && n.category === "needs-input" && !n.done),
    [all],
  );
  const active = useMemo(() => open.filter((n) => !n.muted), [open]);
  const muted = useMemo(() => open.filter((n) => n.muted), [open]);
  return { active, muted };
}

function useNotificationSummary(sessionId: string): NotificationStatusSnapshot {
  const notificationUrgency = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.notificationUrgency,
  );
  const activeNotificationCount = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.activeNotificationCount,
  );
  const activeNeedsInputNotificationCount = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.activeNeedsInputNotificationCount,
  );
  const activeReviewNotificationCount = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.activeReviewNotificationCount,
  );
  const notificationStatusVersion = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.notificationStatusVersion,
  );
  const notificationStatusUpdatedAt = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.notificationStatusUpdatedAt,
  );
  return useMemo(
    () => ({
      notificationUrgency,
      activeNotificationCount,
      activeNeedsInputNotificationCount,
      activeReviewNotificationCount,
      notificationStatusVersion,
      notificationStatusUpdatedAt,
    }),
    [
      notificationUrgency,
      activeNotificationCount,
      activeNeedsInputNotificationCount,
      activeReviewNotificationCount,
      notificationStatusVersion,
      notificationStatusUpdatedAt,
    ],
  );
}

function getNotificationBreakdown(notifications: ReadonlyArray<Pick<SessionNotification, "category" | "muted">>) {
  let needsInput = 0;
  let review = 0;
  for (const notification of notifications) {
    if (notification.category === "needs-input" && notification.muted) continue;
    if (notification.category === "needs-input") needsInput += 1;
    else if (notification.category === "review") review += 1;
  }
  return { needsInput, review, waiting: 0 };
}

function getSummaryBreakdown(summary: NotificationStatusSnapshot) {
  const count = summary.activeNeedsInputNotificationCount ?? summary.activeNotificationCount ?? 0;
  if (count <= 0) return { needsInput: 0, review: 0, waiting: 0 };
  if (summary.notificationUrgency === "needs-input") return { needsInput: count, review: 0, waiting: 0 };
  return { needsInput: 0, review: 0, waiting: 0 };
}

function getEffectiveNotificationBreakdown(
  notifications: ReadonlyArray<Pick<SessionNotification, "category" | "muted">>,
  summary: NotificationStatusSnapshot,
) {
  if (isClearedNotificationStatus(summary)) return { needsInput: 0, review: 0, waiting: 0 };
  const live = getNotificationBreakdown(notifications);
  const liveTotal = live.needsInput + live.review + live.waiting;
  const summaryCount = summary.activeNotificationCount ?? 0;
  const summaryNeedsInputCount = summary.activeNeedsInputNotificationCount;
  const hasFreshSummary =
    summary.notificationStatusVersion !== undefined || summary.notificationStatusUpdatedAt !== undefined;
  const summaryUrgency = summary.notificationUrgency;
  if (hasFreshSummary && summaryNeedsInputCount !== undefined && summaryNeedsInputCount !== live.needsInput) {
    return { needsInput: summaryNeedsInputCount, review: 0, waiting: 0 };
  }
  if (hasFreshSummary && summaryCount > 0 && summaryUrgency) {
    const liveDisagreesWithSummary =
      liveTotal !== summaryCount ||
      (summaryUrgency === "needs-input" && live.needsInput === 0) ||
      (summaryUrgency === "review" && live.needsInput > 0);
    if (liveDisagreesWithSummary) return getSummaryBreakdown(summary);
  }
  if (hasFreshSummary && summaryCount > 0 && summaryUrgency === null && liveTotal !== summaryCount) {
    return getSummaryBreakdown(summary);
  }
  return live;
}

function formatChipAriaLabel({
  needsInput,
  review,
  waiting,
  mutedNeedsInput,
}: {
  needsInput: number;
  review: number;
  waiting: number;
  mutedNeedsInput: number;
}): string {
  const parts: string[] = [];
  if (needsInput > 0)
    parts.push(`${needsInput} ${needsInput === 1 ? "needs-input notification" : "needs-input notifications"}`);
  if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? "waiting status" : "waiting statuses"}`);
  if (mutedNeedsInput > 0) {
    parts.push(`${mutedNeedsInput} muted needs-input ${mutedNeedsInput === 1 ? "notification" : "notifications"}`);
  }
  return parts.length > 0 ? `Notification inbox: ${parts.join(", ")}` : "Notification inbox: no active notifications";
}

function NotificationCountInline({
  category,
  count,
  labelText,
  tone = "active",
}: {
  category: NotificationCategory;
  count: number;
  labelText: string;
  tone?: "active" | "muted";
}) {
  const isNeedsInput = category === "needs-input";
  const isReview = category === "review";
  const mutedTone = tone === "muted";
  const iconClassName = mutedTone
    ? "text-cc-muted"
    : isNeedsInput
      ? "text-cc-attention"
      : isReview
        ? "text-cc-info"
        : "text-cc-muted/85";
  const label = isNeedsInput ? "Needs input" : isReview ? "Review" : "Waiting";

  return (
    <span
      data-testid={`notification-chip-${category}`}
      className="inline-flex items-center gap-1 whitespace-nowrap"
      aria-hidden="true"
      title={`${label}: ${count}`}
    >
      <span className="text-cc-fg/95">{count}</span>
      <svg
        className={`h-3.5 w-3.5 shrink-0 ${iconClassName}`}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {category === "waiting" ? (
          <>
            <path d="M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5z" />
            <path d="M8 5.25V8l1.75 1.1" />
          </>
        ) : (
          <>
            <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 2.5-1.5 4-1.5 4h12s-1.5-1.5-1.5-4A4.5 4.5 0 0 0 8 1.5z" />
            <path d="M6 12a2 2 0 0 0 4 0" />
          </>
        )}
      </svg>
      {labelText && (
        <span
          className={
            mutedTone
              ? "text-cc-muted"
              : isNeedsInput
                ? "text-cc-attention"
                : isReview
                  ? "text-cc-info"
                  : "text-cc-muted/85"
          }
        >
          {labelText}
        </span>
      )}
    </span>
  );
}

// ─── Notification Chip (floating pill) ───────────────────────────────────────

/**
 * Dispatched by the "Next Item in This Session" keyboard shortcut, with the session on screen
 * as `detail.sessionId`; that session's chip takes the step.
 */
export const ATTENTION_NEXT_IN_SESSION_EVENT = "takode:attention-next-in-session";

/**
 * Floating attention chip: a one-tap "next" button for this session. Each tap
 * opens the next item that needs the user here (questions, urgent answers,
 * reminders, unread answers by topic, then Notify Me results), walking the whole
 * list and wrapping at the end; the label shows the next item's position.
 * Long-press (phone) or right-click (desktop) opens the session's list, which
 * reads like the top bar's Needs attention list. With nothing to step through
 * (only muted prompts, or counts whose details have not loaded), a tap opens
 * the list instead.
 * `attentionPreview` supplies fixed Notify Me and unread data for the Playground.
 */
export function NotificationChip({
  sessionId,
  attentionPreview,
}: {
  sessionId: string;
  attentionPreview?: SessionAttentionPreview;
}) {
  const { active, muted } = useNotifications(sessionId);
  const summary = useNotificationSummary(sessionId);
  const attention = useSessionAttention(sessionId, active, attentionPreview);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const { needsInput, review, waiting } = useMemo(
    () => getEffectiveNotificationBreakdown(active, summary),
    [active, summary],
  );
  const mutedNeedsInput = muted.length;
  const { next, goNext } = attention;
  // Places, as in the top bar: a topic's new answers count once while Next steps through each.
  const total = countAttentionPlaces(attention.queue);
  const place = next ? attentionPlaceIndex(attention.queue, next.item) : 0;
  const inboxLabel = useMemo(
    () => formatChipAriaLabel({ needsInput, review, waiting, mutedNeedsInput }),
    [mutedNeedsInput, needsInput, review, waiting],
  );
  const longPress = useLongPress(() => setOpen(true));

  const close = useCallback(() => setOpen(false), []);
  const activate = useCallback(() => {
    if (!next) {
      setOpen((p) => !p);
      return;
    }
    setOpen(false);
    goNext();
  }, [goNext, next]);

  // The shortcut steps like a tap, but with nothing to step through it does nothing:
  // opening the list from the keyboard would only cover the feed.
  useEffect(() => {
    const onShortcut = (event: Event) => {
      if ((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId !== sessionId || !next) return;
      setOpen(false);
      goNext();
    };
    window.addEventListener(ATTENTION_NEXT_IN_SESSION_EVENT, onShortcut);
    return () => window.removeEventListener(ATTENTION_NEXT_IN_SESSION_EVENT, onShortcut);
  }, [goNext, next, sessionId]);

  if (needsInput + waiting + total === 0 && mutedNeedsInput === 0) return null;

  const nextKind = next ? attentionKindOf(next.item) : null;
  const tone = nextKind ? attentionTone(nextKind) : null;
  return (
    <>
      <div ref={chipRef} data-testid="session-attention-chip" className="pointer-events-auto relative inline-flex">
        <button
          type="button"
          {...longPress.handlers}
          style={longPress.pressStyle}
          onClick={activate}
          aria-label={
            next
              ? `Go to the next item that needs attention in this session: ${ATTENTION_KIND_TITLE[nextKind!]}, ${place + 1} of ${total}. Right-click or long-press for the list.`
              : inboxLabel
          }
          title={next ? "Next item that needs attention here. Right-click or long-press for the list." : undefined}
          data-testid={next ? "session-attention-next" : undefined}
          aria-expanded={open}
          className={`relative inline-flex max-w-[min(18rem,calc(100vw-2.75rem))] items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[18px] border bg-cc-card/95 py-1 pl-2.5 pr-1.5 text-[11px] text-cc-muted font-mono-code shadow-[0_10px_30px_rgba(0,0,0,0.22)] backdrop-blur-md transition-colors hover:border-cc-muted/35 cursor-pointer ${LONG_PRESS_TARGET_CLASS} ${
            tone ? tone.border : "border-cc-border pr-2.5"
          }`}
        >
          <span className="pointer-events-none absolute inset-0 bg-cc-hover/20" />
          {next ? (
            <>
              <span className="relative inline-flex">
                <AttentionKindIcon kind={nextKind!} />
              </span>
              <span className="relative tabular-nums text-cc-fg/95" data-testid="session-attention-position">
                {place + 1}/{total}
              </span>
              <span className="relative text-cc-muted">·</span>
              {/* "Next" rather than the kind ("needs input" was long); the tinted icon tells the kinds apart. */}
              <span className={`relative ${tone!.text}`}>Next</span>
              <span className={`relative ${tone!.text}`}>
                <NextChevron />
              </span>
            </>
          ) : mutedNeedsInput > 0 && needsInput === 0 ? (
            <span className="relative">
              <NotificationCountInline category="needs-input" count={0} labelText="needs input" tone="muted" />
            </span>
          ) : needsInput > 0 ? (
            <span className="relative">
              <NotificationCountInline category="needs-input" count={needsInput} labelText="needs input" />
            </span>
          ) : (
            <span className="relative">
              <NotificationCountInline category="waiting" count={waiting} labelText="status" />
            </span>
          )}
        </button>
      </div>

      {open && (
        <SessionAttentionList
          sessionId={sessionId}
          chip={chipRef.current}
          queue={attention.queue}
          next={next?.item ?? null}
          muted={muted}
          onNext={goNext}
          onOpen={(item) => {
            attention.open(item);
            close();
          }}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * The chip's list: the top bar's Needs attention list for this session alone. Every row is this
 * session, so none names it; each names its topic instead. Below the queue, collapsed, sit this
 * session's muted questions, watched threads with no result yet and snoozed threads.
 */
function SessionAttentionList({
  sessionId,
  chip,
  queue,
  next,
  muted,
  onNext,
  onOpen,
  onClose,
}: {
  sessionId: string;
  chip: HTMLElement | null;
  queue: readonly NextAttentionItem[];
  next: NextAttentionItem | null;
  muted: readonly SessionNotification[];
  onNext: () => void;
  onOpen: (item: NextAttentionItem) => void;
  onClose: () => void;
}) {
  const source = useStore(
    useShallow((s) => ({
      session: s.sdkSessions.find((entry) => entry.sessionId === sessionId),
      syncedProjectionValues: s.syncedProjectionValues,
      syncedProjectionKeys: s.syncedProjectionKeys,
    })),
  );
  const monitoring = getSyncedProjectionValue(source, THREAD_MONITORING_PROJECTION, sessionId);
  const waitingTracked = monitoring ? monitoring.trackedCount - monitoring.pendingCount : 0;
  const tracked = useTrackedNotifyMeEntries(waitingTracked > 0, `${sessionId}:${monitoring?.revision ?? ""}`);
  const backlog = useMemo(() => {
    const { session } = source;
    const reminders = session ? collectThreadReminders({ ...source, sdkSessions: [session] }) : [];
    return buildAttentionBacklog({
      muted: muted.map((notification) => ({
        sessionId,
        sessionName: session?.name ?? "",
        sessionNum: session?.sessionNum ?? null,
        notification,
      })),
      tracked: tracked.filter((entry) => entry.sessionId === sessionId),
      reminders,
    });
  }, [muted, sessionId, source, tracked]);
  const listed = useMemo(
    () => [...queue, ...backlog.muted, ...backlog.tracked, ...backlog.reminders],
    [backlog, queue],
  );
  const topicOf = useAttentionTopicOf(listed);
  const position = useChipListPosition(chip);
  return (
    <AttentionListPanel
      items={queue}
      nextKey={next?.key ?? null}
      nextPosition={next ? attentionPlaceIndex(queue, next) + 1 : null}
      backlog={backlog}
      trackedCount={waitingTracked}
      trigger={chip}
      onClose={onClose}
      onNext={onNext}
      onOpen={onOpen}
      session={{ topicFor: (item) => topicOf(item.sessionId, item.threadKey)?.name, position }}
    />
  );
}

/**
 * Where the chip's list goes: inside the chat feed, right-aligned with the chip and opening
 * upward from it, no wider or taller than the feed allows, so it never covers the side column.
 * The chip sits in the feed's floating stack, whose parent is the feed's box.
 */
function useChipListPosition(chip: HTMLElement | null): { className: string; style: CSSProperties } {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!chip) return;
    const feed = chip.closest("[data-feed-floating-stack]")?.parentElement ?? null;
    const update = () => {
      const chipBox = chip.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const feedBox = feed?.getBoundingClientRect() ?? { left: 0, top: 0 };
      setStyle({
        right: Math.max(LIST_GAP_PX, viewportWidth - chipBox.right),
        bottom: viewportHeight - chipBox.top + LIST_GAP_PX,
        width: Math.min(LIST_MAX_WIDTH_PX, chipBox.right - feedBox.left - LIST_GAP_PX),
        maxHeight: Math.min(LIST_MAX_HEIGHT_PX, chipBox.top - feedBox.top - 2 * LIST_GAP_PX),
      });
    };
    update();
    window.addEventListener("resize", update);
    // A page that scrolls under it (the Playground, a phone's visual viewport) moves the chip.
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(chip);
    if (feed) observer?.observe(feed);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [chip]);
  return { className: "fixed z-50", style };
}
