/**
 * Follow-up phone reminders for questions the user has left waiting.
 *
 * Each needs-input question already gets one phone alert when it is asked. If the
 * user then stays away from Takode, this sends one summary of every waiting
 * question after a stretch of inactivity, repeating with doubling gaps, capped
 * per local day and held back during quiet hours. Any user activity starts the
 * cycle over.
 *
 * Activity means something the user did: a message or answer in any session
 * (known to the server), or a tap or key press in a Takode window (reported by
 * the browser). An open Takode screen that nobody touches is not activity.
 */

import type { NeedsInputReminderSettings } from "../shared/needs-input-reminder-settings.js";

/** One open, unmuted question addressed to the user. */
export interface WaitingQuestion {
  /** Stable per question, such as `<sessionId>:<notificationId>`. */
  key: string;
  /** When it was asked. */
  askedAt: number;
}

export interface ReminderAlert {
  title: string;
  body: string;
  /** App path the alert opens. */
  path: string;
}

export interface NeedsInputRemindersDeps<Q extends WaitingQuestion> {
  getSettings: () => NeedsInputReminderSettings;
  getWaitingQuestions: () => Q[];
  /** The user's latest message or answer in any session. */
  getLastUserMessageAt: () => number;
  /** Short name for the summary, such as the quest title; resolved only when a reminder is sent. */
  describe: (question: Q) => Promise<string>;
  send: (alert: ReminderAlert) => void;
  now?: () => number;
}

/** Opens the top bar's attention list (see `ATTENTION_LIST_HASH` in the frontend routing). */
export const ATTENTION_LIST_PATH = "/#/attention";

const CHECK_INTERVAL_MS = 60_000;
const MAX_NAMES = 5;

export class NeedsInputReminders<Q extends WaitingQuestion = WaitingQuestion> {
  private readonly deps: NeedsInputRemindersDeps<Q>;
  private readonly now: () => number;
  private lastBrowserActivityAt = 0;
  /**
   * When this server first saw each waiting question. A question that comes
   * back from a snooze or mute counts as new (it gets a fresh alert), and after
   * a restart every question does, which also keeps restarts from sending one.
   */
  private firstSeenAt = new Map<string, number>();
  /** The reminders sent since the user's last activity. */
  private cycle = { activityAt: 0, sent: 0, lastSentAt: 0 };
  private day = { key: "", sent: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: NeedsInputRemindersDeps<Q>) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** A tap or key press in a Takode window. */
  recordUserActivity(at = this.now()): void {
    this.lastBrowserActivityAt = Math.max(this.lastBrowserActivityAt, at);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Send a reminder if one is due now. Returns whether one was sent. */
  async check(): Promise<boolean> {
    const settings = this.deps.getSettings();
    if (!settings.enabled) return false;
    const now = this.now();
    const questions = this.deps.getWaitingQuestions();
    this.trackFirstSeen(questions, now);

    const activityAt = Math.max(this.lastBrowserActivityAt, this.deps.getLastUserMessageAt());
    if (questions.length === 0 || activityAt > this.cycle.activityAt) {
      this.cycle = { activityAt, sent: 0, lastSentAt: 0 };
    }
    if (questions.length === 0) return false;

    // The first reminder also waits out the newest question, which just had its own alert.
    const inactivityMs = settings.inactivityMinutes * 60_000;
    const dueAt =
      this.cycle.sent === 0
        ? Math.max(activityAt, ...questions.map((q) => this.firstSeenAt.get(q.key) ?? now)) + inactivityMs
        : this.cycle.lastSentAt + inactivityMs * 2 ** this.cycle.sent;
    if (now < dueAt || isQuietHour(now, settings)) return false;

    const dayKey = new Date(now).toDateString();
    if (this.day.key !== dayKey) this.day = { key: dayKey, sent: 0 };
    if (this.day.sent >= settings.dailyMax) return false;

    // Count it before the names resolve, so a slow lookup cannot let a second check send it again.
    this.cycle.sent++;
    this.cycle.lastSentAt = now;
    this.day.sent++;
    this.deps.send(await this.buildAlert(questions, now));
    return true;
  }

  private trackFirstSeen(questions: Q[], now: number): void {
    const waiting = new Set(questions.map((q) => q.key));
    for (const key of this.firstSeenAt.keys()) {
      if (!waiting.has(key)) this.firstSeenAt.delete(key);
    }
    for (const key of waiting) {
      if (!this.firstSeenAt.has(key)) this.firstSeenAt.set(key, now);
    }
  }

  /** "3 questions waiting for you (oldest 5h)", naming them oldest first. */
  private async buildAlert(questions: Q[], now: number): Promise<ReminderAlert> {
    const oldestFirst = [...questions].sort((a, b) => a.askedAt - b.askedAt);
    const names = [...new Set(await Promise.all(oldestFirst.map((q) => this.deps.describe(q))))];
    const shown = names.slice(0, MAX_NAMES).join(", ");
    const count = questions.length;
    return {
      title: `${count} ${count === 1 ? "question" : "questions"} waiting for you (oldest ${formatAge(now - oldestFirst[0]!.askedAt)})`,
      body: names.length > MAX_NAMES ? `${shown}, and ${names.length - MAX_NAMES} more` : shown,
      path: ATTENTION_LIST_PATH,
    };
  }
}

/** Whether `at` falls in quiet hours, which may wrap past midnight (23 to 9). */
export function isQuietHour(at: number, settings: Pick<NeedsInputReminderSettings, "quietStartHour" | "quietEndHour">) {
  const hour = new Date(at).getHours();
  const { quietStartHour: start, quietEndHour: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function formatAge(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
