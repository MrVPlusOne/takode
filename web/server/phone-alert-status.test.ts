import { describe, expect, it } from "vitest";
import { isPhoneAlertOutdated, type PhoneAlertSession } from "./phone-alert-status.js";

/**
 * When the user taps a phone alert, the other shown alerts are closed once everything they
 * are about is settled: questions answered, dismissed or muted, permission requests answered,
 * Notify Me results acknowledged and finished turns read. Anything the check cannot judge
 * (older alerts without subjects, unknown kinds, malformed input from the phone) stays.
 */

const notification = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, category: "needs-input", timestamp: 1000, messageId: null, done: false, ...extra }) as never;

function lookup(sessions: Record<string, PhoneAlertSession>, archived: string[] = []) {
  return { getSession: (id: string) => sessions[id], isArchived: (id: string) => archived.includes(id) };
}

const question = (notificationId: string, sessionId = "s1") => ({ kind: "question", sessionId, notificationId });

describe("isPhoneAlertOutdated", () => {
  it("settles a question once it is answered, dismissed or muted, and keeps it while open", () => {
    const sessions = lookup({
      s1: {
        notifications: [
          notification("open"),
          notification("done", { done: true }),
          notification("muted", { muted: true }),
          notification("snoozed", { muted: true, snoozedUntil: 9e12 }),
        ],
      },
    });

    expect(isPhoneAlertOutdated([question("open")], sessions)).toBe(false);
    expect(isPhoneAlertOutdated([question("done")], sessions)).toBe(true);
    expect(isPhoneAlertOutdated([question("muted")], sessions)).toBe(true);
    expect(isPhoneAlertOutdated([question("snoozed")], sessions)).toBe(true);
    expect(isPhoneAlertOutdated([question("deleted")], sessions)).toBe(true);
  });

  it("keeps a batched alert while any one of its items still waits", () => {
    const sessions = lookup({ s1: { notifications: [notification("open"), notification("done", { done: true })] } });

    expect(isPhoneAlertOutdated([question("done"), question("open")], sessions)).toBe(false);
  });

  it("settles everything from an archived or missing session", () => {
    const sessions = lookup({ s1: { notifications: [notification("open")] } }, ["s1"]);

    expect(isPhoneAlertOutdated([question("open")], sessions)).toBe(true);
    expect(isPhoneAlertOutdated([question("open", "gone")], sessions)).toBe(true);
  });

  it("settles a permission request once it is no longer pending", () => {
    const sessions = lookup({ s1: { pendingPermissions: new Map([["req-open", {}]]) } });
    const permission = (requestId: string) => [{ kind: "permission", sessionId: "s1", requestId }];

    expect(isPhoneAlertOutdated(permission("req-open"), sessions)).toBe(false);
    expect(isPhoneAlertOutdated(permission("req-done"), sessions)).toBe(true);
  });

  it("settles a Notify Me result once the thread no longer holds that result", () => {
    const sessions = lookup({ s1: { state: { threadMonitoring: { threads: { "q-1": { pending: { id: "r2" } } } } } } });
    const result = (resultId: string) => [{ kind: "notify-me", sessionId: "s1", threadKey: "q-1", resultId }];

    expect(isPhoneAlertOutdated(result("r2"), sessions)).toBe(false);
    // Replaced by a newer result, acknowledged or replied to: the older alert is outdated.
    expect(isPhoneAlertOutdated(result("r1"), sessions)).toBe(true);
  });

  it("settles a finished turn, review or error once the session is read after it", () => {
    const sessions = lookup({ s1: { lastReadAt: 5000 } });
    const unread = (since: number) => [{ kind: "unread", sessionId: "s1", since }];

    expect(isPhoneAlertOutdated(unread(5000), sessions)).toBe(true);
    expect(isPhoneAlertOutdated(unread(6000), sessions)).toBe(false);
  });

  it("keeps alerts it cannot judge", () => {
    const sessions = lookup({ s1: {} });

    expect(isPhoneAlertOutdated(null, sessions)).toBe(false);
    expect(isPhoneAlertOutdated([], sessions)).toBe(false);
    expect(isPhoneAlertOutdated("question", sessions)).toBe(false);
    expect(isPhoneAlertOutdated([{ kind: "todo", sessionId: "s1" }], sessions)).toBe(false);
    expect(isPhoneAlertOutdated([{ kind: "question" }], sessions)).toBe(false);
    expect(isPhoneAlertOutdated([{ kind: "unread", sessionId: "s1" }], sessions)).toBe(false);
  });
});
