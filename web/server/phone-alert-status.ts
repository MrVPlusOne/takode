/**
 * What a Web Push phone alert is about, so a tapped alert can clear the outdated ones.
 *
 * Each alert carries its subjects. When the user taps a Takode alert, the service worker
 * (`web/public/sw.js`) sends the subjects of every alert still on the phone and closes the
 * ones reported outdated. That tap is the only moment it can: iOS lets a service worker close
 * shown notifications only while it handles a tap, and every push must show something, so
 * alerts are never retracted by a later push (see `web-push.ts`).
 */

import type { SessionNotification } from "./session-types.js";

export type PhoneAlertSubject =
  /** A needs-input question; waiting until answered, dismissed or muted (snoozing mutes). */
  | { kind: "question"; sessionId: string; notificationId: string }
  /** A permission request or AskUserQuestion; waiting until it is answered. */
  | { kind: "permission"; sessionId: string; requestId: string }
  /** A Notify Me result; waiting until it is acknowledged, replied to or replaced. */
  | { kind: "notify-me"; sessionId: string; threadKey: string; resultId: string }
  /** A finished turn, review or error; waiting until the session is read after `since`. */
  | { kind: "unread"; sessionId: string; since: number };

/** The parts of a live session the subjects are checked against. */
export interface PhoneAlertSession {
  notifications?: SessionNotification[];
  pendingPermissions?: Map<string, unknown>;
  lastReadAt?: number;
  state?: { threadMonitoring?: { threads: Record<string, { pending: { id: string } | null } | undefined> } };
}

export interface PhoneAlertLookup {
  getSession: (sessionId: string) => PhoneAlertSession | undefined;
  isArchived: (sessionId: string) => boolean;
}

/**
 * True when nothing an alert is about still waits for the user. `subjects` comes from the
 * phone, so anything unrecognized counts as still waiting: an alert from before subjects
 * existed, or one about something this check does not cover (such as overdue to-dos), stays.
 */
export function isPhoneAlertOutdated(subjects: unknown, lookup: PhoneAlertLookup): boolean {
  if (!Array.isArray(subjects) || subjects.length === 0) return false;
  return subjects.every((subject) => isSubjectSettled(subject, lookup));
}

function isSubjectSettled(subject: unknown, lookup: PhoneAlertLookup): boolean {
  const s = subject as Partial<Record<string, unknown>> | null;
  if (typeof s?.sessionId !== "string") return false;
  const session = lookup.isArchived(s.sessionId) ? undefined : lookup.getSession(s.sessionId);
  switch (s.kind) {
    case "question": {
      const notification = session?.notifications?.find((n) => n.id === s.notificationId);
      return !notification || notification.done || !!notification.muted;
    }
    case "permission":
      return !session?.pendingPermissions?.has(String(s.requestId));
    case "notify-me":
      return session?.state?.threadMonitoring?.threads[String(s.threadKey)]?.pending?.id !== s.resultId;
    case "unread":
      return typeof s.since === "number" && (!session || (session.lastReadAt ?? 0) >= s.since);
    default:
      return false;
  }
}
