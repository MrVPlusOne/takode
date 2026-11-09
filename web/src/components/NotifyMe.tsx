import { useMemo, useRef, useState, type Ref } from "react";
import { useShallow } from "zustand/react/shallow";
import { THREAD_MONITORING_PROJECTION, type ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import { useStore } from "../store.js";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";
import type { SdkSessionInfo } from "../types.js";
import { navigateToSessionMessageId, navigateToSessionThread, routeSessionRefForId } from "../utils/routing.js";
import { useThreadReminder } from "../utils/thread-reminders.js";
import { NotifyMeMenu } from "./NotifyMeMenu.js";
import { ClockIcon, formatSnoozeUntil, snoozeUntilParts } from "./RemindLaterChoices.js";

/**
 * Notify Me's target icon. A filled center means Notify Me is on; a dot means a result is waiting.
 * `decorative` is for the icon inside a labelled control: it takes the control's color and leaves
 * the tooltip and label to the control.
 */
export function NotifyMeIcon({
  pending = false,
  monitored = true,
  decorative = false,
  className = "h-3 w-3",
}: {
  pending?: boolean;
  monitored?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const svg = (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.7" />
      <circle cx="8" cy="8" r="2.6" fill={monitored ? "currentColor" : "none"} />
      <path d="M8 8 12.8 3.2" />
      {pending && <circle cx="12.5" cy="3.5" r="2.3" fill="currentColor" stroke="var(--color-cc-bg)" />}
    </svg>
  );
  if (decorative) return svg;
  return (
    <span
      className={`inline-flex shrink-0 ${pending ? "text-cc-info" : "text-cc-muted"}`}
      title={
        !monitored
          ? "Notify Me: get notified about new results"
          : pending
            ? "Notify Me: result waiting"
            : "Notify Me is on"
      }
      role="img"
      aria-label={!monitored ? "Notify Me" : pending ? "Monitored task has a result waiting" : "Monitored task"}
    >
      {svg}
    </span>
  );
}

/**
 * A thread's Notify button. With a result waiting it acknowledges in one tap; otherwise it
 * opens the Notify Me menu (now, or later). With a reminder set it shows when the thread
 * comes back. While Notify Me is on (or a reminder is set) it is a tinted pill with a filled
 * target, so its state shows without hovering.
 */
export function NotifyMeControlView({
  enabled,
  pending,
  reminderAt,
  disabled,
  error,
  expanded = false,
  buttonRef,
  onOpen,
  onAcknowledge,
  className,
  iconOnly = false,
}: {
  /** Only the icon, its meaning in the tooltip. */
  iconOnly?: boolean;
  /**
   * Replaces the chip's shape, such as for a bordered button among the quest views' session buttons.
   * Colors stay with the control, because they show whether Notify Me is on.
   */
  className?: string;
  enabled: boolean;
  pending: boolean;
  /** When a "Remind me later" brings the thread back, if one is set. */
  reminderAt?: number;
  disabled?: boolean;
  error?: string | null;
  expanded?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onOpen: () => void;
  onAcknowledge: () => void;
}) {
  const highlighted = enabled || reminderAt !== undefined;
  const label = pending
    ? "Acknowledge this result"
    : reminderAt !== undefined
      ? `Notify Me: back ${formatSnoozeUntil(reminderAt)}`
      : enabled
        ? "Notify Me is on"
        : "Notify Me: now or later";
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1" data-testid="notify-me-control">
      <button
        ref={buttonRef}
        type="button"
        aria-label={pending ? "Acknowledge" : highlighted ? label : "Notify Me"}
        aria-haspopup={pending ? undefined : "dialog"}
        aria-expanded={pending ? undefined : expanded}
        disabled={disabled}
        onClick={pending ? onAcknowledge : onOpen}
        title={label}
        data-notify-me-on={highlighted || undefined}
        className={`${className ?? "inline-flex h-6 shrink-0 items-center gap-1 rounded px-1 text-[11px]"} whitespace-nowrap transition-colors cursor-pointer focus-visible:outline focus-visible:outline-cc-primary disabled:opacity-50 ${highlighted ? "border-cc-info-border bg-cc-info-bg text-cc-info hover:border-cc-info" : "border-cc-border text-cc-muted hover:bg-cc-hover hover:text-cc-fg"}`}
      >
        {reminderAt !== undefined && !pending ? (
          <ReminderTime at={reminderAt} compact={iconOnly} />
        ) : (
          <>
            <NotifyMeIcon pending={pending} monitored={enabled} decorative />
            {!iconOnly && (pending ? "Acknowledge" : "Notify")}
          </>
        )}
      </button>
      {error && (
        <span role="alert" className="text-[10px] text-cc-error">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * When a reminder brings the thread back, on one line: "10:17 PM" today, "Sun 10:17 PM" this week,
 * the date later. `compact` (an icon button on a thread's strip) drops a later day's time on a phone.
 */
function ReminderTime({ at, compact }: { at: number; compact: boolean }) {
  const { day, time } = snoozeUntilParts(at);
  return (
    <>
      <ClockIcon />
      <span className="whitespace-nowrap" data-testid="notify-me-reminder-time">
        {day}
        {day && <span className={compact ? "max-sm:hidden" : ""}> {time}</span>}
        {!day && time}
      </span>
    </>
  );
}

/** The Notify button for a quest tab or Main, wired to the server's monitoring and reminder state. */
export function NotifyMeControl({
  sessionId,
  threadKey,
  iconOnly = false,
  className,
}: {
  sessionId: string;
  threadKey: string;
  /** Only the icon, its state in the color and tooltip (the quest strip, short of room). */
  iconOnly?: boolean;
  className?: string;
}) {
  const projection = useStore((state) => getSyncedProjectionValue(state, THREAD_MONITORING_PROJECTION, sessionId));
  const reminder = useThreadReminder(sessionId, threadKey);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMain = threadKey === "main";
  if (!isMain && !/^q-\d+$/.test(threadKey)) return null;
  const monitor = projection?.threads[threadKey];
  // Main has a monitor only while a reminder waits; it is never "on".
  const tracking = Boolean(monitor) && !isMain;
  async function act(action: "track" | "untrack" | "acknowledge") {
    setBusy(true);
    setError(null);
    try {
      await updateThreadMonitoring(sessionId, threadKey, action, monitor?.pendingResultId ?? undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please retry");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <NotifyMeControlView
        enabled={tracking}
        pending={Boolean(monitor?.pendingResultId)}
        reminderAt={reminder?.remindAt}
        disabled={!projection || busy}
        error={error}
        expanded={open}
        buttonRef={buttonRef}
        onOpen={() => setOpen((value) => !value)}
        onAcknowledge={() => void act("acknowledge")}
        className={className}
        iconOnly={iconOnly}
      />
      {open && (
        <NotifyMeMenu
          sessionId={sessionId}
          threadKey={threadKey}
          tracking={tracking}
          onSetTracking={
            isMain
              ? undefined
              : (enabled) => updateThreadMonitoring(sessionId, threadKey, enabled ? "track" : "untrack")
          }
          anchor={buttonRef.current?.getBoundingClientRect() ?? null}
          trigger={buttonRef.current}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Notify Me counts across sessions from the synchronized projection. `signature`
 * changes whenever any session's monitoring state changes, so callers can refetch.
 */
export function useNotifyMeSummary() {
  const state = useStore(
    useShallow((state) => ({
      sdkSessions: state.sdkSessions,
      syncedProjectionValues: state.syncedProjectionValues,
      syncedProjectionKeys: state.syncedProjectionKeys,
    })),
  );
  const summary = useMemo(() => {
    let pending = 0;
    let tracked = 0;
    const revisions: string[] = [];
    for (const session of state.sdkSessions) {
      if (session.archived) continue;
      const value = getSyncedProjectionValue(state, THREAD_MONITORING_PROJECTION, session.sessionId);
      if (!value) continue;
      pending += value.pendingCount;
      tracked += value.trackedCount;
      revisions.push(`${session.sessionId}:${value.revision}`);
    }
    return { pending, tracked, signature: revisions.join("|") };
  }, [state]);
  return { ...summary, sdkSessions: state.sdkSessions };
}

/** Open a monitored thread at its waiting result, or at the thread when nothing is waiting. */
export function openNotifyMeEntry(entry: ThreadMonitoringEntry, sdkSessions: SdkSessionInfo[]) {
  const routeSessionId = routeSessionRefForId(entry.sessionId, sdkSessions);
  if (entry.pending?.messageId)
    navigateToSessionMessageId(entry.sessionId, entry.pending.messageId, {
      routeSessionId,
      threadKey: entry.threadKey,
    });
  else navigateToSessionThread(entry.sessionId, entry.threadKey, false, routeSessionId);
}
