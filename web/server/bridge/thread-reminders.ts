/**
 * "Remind me later" for a leader thread: the user has read a result but cannot act on it
 * yet. A reminder keeps the thread's wake time on the leader session (so it survives
 * restarts); when it comes due the thread enters Notify Me with a result to acknowledge and
 * a phone alert. Woken by the ws-bridge watchdog sweep, up to ~30 s late.
 */
import { normalizeLeaderThreadKey } from "../../shared/leader-open-thread-tabs.js";
import { recordReminderResult } from "../thread-monitoring.js";

/** One thread's reminder, keyed by normalized thread key on `state.leaderThreadReminders`. */
export interface LeaderThreadReminder {
  /** When the thread comes back to the user's attention. */
  remindAt: number;
  setAt: number;
  /** The message the user set it from, when set from a message: the reminder opens there. */
  messageId?: string;
}

type SessionLike = any;

interface ThreadReminderDeps {
  /** Also republishes the session's projections, where browsers read reminders. */
  persistSession: (session: SessionLike) => void;
}

export function setThreadReminder(
  session: SessionLike,
  input: { threadKey: string; remindAt: number; messageId?: string },
  deps: ThreadReminderDeps,
): LeaderThreadReminder {
  const reminder: LeaderThreadReminder = {
    remindAt: input.remindAt,
    setAt: Date.now(),
    ...(input.messageId ? { messageId: input.messageId } : {}),
  };
  session.state.leaderThreadReminders = {
    ...session.state.leaderThreadReminders,
    [normalizeLeaderThreadKey(input.threadKey)]: reminder,
  };
  deps.persistSession(session);
  return reminder;
}

export function cancelThreadReminder(session: SessionLike, threadKey: string, deps: ThreadReminderDeps): boolean {
  const key = normalizeLeaderThreadKey(threadKey);
  const reminders: Record<string, LeaderThreadReminder> | undefined = session.state.leaderThreadReminders;
  if (!reminders?.[key]) return false;
  const { [key]: _cancelled, ...rest } = reminders;
  session.state.leaderThreadReminders = rest;
  deps.persistSession(session);
  return true;
}

/**
 * Bring back every thread whose reminder has come due: it enters Notify Me with a result to
 * acknowledge, its tab returns, and the phone is alerted. Reminders that came due while the
 * server was down wake on the first sweep after restart. Archived sessions keep theirs.
 */
export function wakeDueThreadReminders(
  sessions: Iterable<SessionLike>,
  now: number,
  deps: ThreadReminderDeps & {
    getLauncherSessionInfo?: (sessionId: string) => { archived?: boolean } | null | undefined;
    onMonitoredThreadResult?: (session: SessionLike, threadKey: string) => void;
    promoteLeaderThreadTabForAttention?: (
      sessionId: string,
      threadKey: string,
      eventAt: number,
      kind: "primary" | "review",
    ) => boolean;
  },
): number {
  let woken = 0;
  for (const session of sessions) {
    const reminders: Record<string, LeaderThreadReminder> | undefined = session.state?.leaderThreadReminders;
    if (!reminders || deps.getLauncherSessionInfo?.(session.id)?.archived) continue;
    const due = Object.keys(reminders).filter((threadKey) => reminders[threadKey]!.remindAt <= now);
    if (due.length === 0) continue;
    session.state.leaderThreadReminders = Object.fromEntries(
      Object.entries(reminders).filter(([, reminder]) => reminder.remindAt > now),
    );
    const alerted = due.filter((threadKey) =>
      recordReminderResult(
        session,
        threadKey,
        `Reminder: ${threadTitle(session, threadKey)}`,
        now,
        reminders[threadKey]!.messageId,
      ),
    );
    for (const threadKey of alerted) {
      if (threadKey !== "main") deps.promoteLeaderThreadTabForAttention?.(session.id, threadKey, now, "primary");
    }
    deps.persistSession(session);
    for (const threadKey of alerted) deps.onMonitoredThreadResult?.(session, threadKey);
    woken += due.length;
  }
  return woken;
}

/** "Main", or the quest's number and board title, for the reminder's alert. */
function threadTitle(session: SessionLike, threadKey: string): string {
  if (threadKey === "main") return "Main";
  const title = (session.board?.get(threadKey) ?? session.completedBoard?.get(threadKey))?.title;
  return title ? `${threadKey} ${title}` : threadKey;
}
