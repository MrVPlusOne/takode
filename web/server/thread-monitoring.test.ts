import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, SessionNotification, SessionState } from "./session-types.js";
import { extractThreadStatusMarkersFromText } from "../shared/thread-status-marker.js";
import { updateLeaderThreadStatusesForAssistantOutput } from "./bridge/thread-routing-reminder.js";
import { clearAttentionAndMarkRead } from "./bridge/session-notification-controller.js";
import {
  acknowledgeMonitoredThreadResult,
  monitoredResultMessageId,
  recordMonitoredThreadResult,
  recordReminderResult,
  setThreadMonitoring,
} from "./thread-monitoring.js";
import { buildThreadMonitoringProjection } from "./thread-monitoring-projection.js";
import { isThreadMonitoringProjectionValue } from "../shared/thread-monitoring.js";

type Assistant = Extract<BrowserIncomingMessage, { type: "assistant" }>;

function fixture() {
  return {
    id: "leader",
    state: {
      isOrchestrator: true,
      leaderOpenThreadTabs: { version: 1, orderedOpenThreadKeys: ["q-42"], closedThreadTombstones: [], updatedAt: 0 },
    } as Pick<SessionState, "isOrchestrator" | "leaderOpenThreadTabs" | "leaderThreadStatuses" | "threadMonitoring">,
    messageHistory: [] as BrowserIncomingMessage[],
    notifications: [] as SessionNotification[],
    attentionReason: "review",
    lastReadAt: 0,
  };
}

function publish(
  session: ReturnType<typeof fixture>,
  id: string,
  kind: "Ready" | "Waiting" = "Ready",
  threadKey = "q-42",
) {
  const timestamp = session.messageHistory.length + 1;
  const entry: Assistant = {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text: "Result is available" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  session.messageHistory.push(entry);
  const parsed = extractThreadStatusMarkersFromText(`{[(Thread ${kind}: ${threadKey} | Result is available)]}`);
  const result = updateLeaderThreadStatusesForAssistantOutput(session, parsed.markers, { messageId: id, timestamp });
  entry.threadStatusMarkers = result.records;
  return result.records;
}

describe("Notify Me result lifecycle", () => {
  it("supports named task tabs only and captures a currently accepted result", () => {
    const session = fixture();
    expect(setThreadMonitoring(session, "main", true)).toBe(false);
    expect(setThreadMonitoring(session, "all", true)).toBe(false);
    publish(session, "initial");
    setThreadMonitoring(session, "q-42", true, { now: 10 });
    expect(session.state.threadMonitoring?.threads["q-42"].pending?.messageId).toBe("initial");
    const revision = session.state.threadMonitoring?.revision;
    expect(setThreadMonitoring(session, "q-42", true)).toBe(false);
    expect(session.state.threadMonitoring?.revision).toBe(revision);
  });

  it("survives ordinary reads, tab closure, activity, and persisted restoration", () => {
    // These operations previously made review notifications vanish; monitoring is a separate owner.
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    publish(session, "result");
    const pending = session.state.threadMonitoring?.threads["q-42"].pending;
    clearAttentionAndMarkRead(session, { persistSession: () => {} });
    session.state.leaderOpenThreadTabs!.orderedOpenThreadKeys = [];
    session.state.leaderThreadStatuses = {};
    const restored = JSON.parse(JSON.stringify(session)) as typeof session;
    const projection = buildThreadMonitoringProjection(restored);
    expect(restored.state.threadMonitoring?.threads["q-42"].pending).toEqual(pending);
    expect(projection).toMatchObject({ trackedCount: 1, pendingCount: 1, threads: {} });
    expect(isThreadMonitoringProjectionValue(projection)).toBe(true);
  });

  it("acknowledges only the observed result, coalesces new results, and re-arms", () => {
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    publish(session, "first");
    const first = session.state.threadMonitoring!.threads["q-42"].pending!.id;
    publish(session, "second");
    expect(acknowledgeMonitoredThreadResult(session, "q-42", first)).toBe(false);
    const second = session.state.threadMonitoring!.threads["q-42"].pending!.id;
    expect(acknowledgeMonitoredThreadResult(session, "q-99", second)).toBe(false);
    expect(acknowledgeMonitoredThreadResult(session, "q-42", second)).toBe(true);
    expect(buildThreadMonitoringProjection(session)).toMatchObject({ trackedCount: 1, pendingCount: 0 });
    publish(session, "third");
    expect(buildThreadMonitoringProjection(session)).toMatchObject({ trackedCount: 1, pendingCount: 1 });
  });

  it("does not revive acknowledged results on replay, summary edits, or duplicate source rows", () => {
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    const [first] = publish(session, "first");
    const [second] = publish(session, "second");
    acknowledgeMonitoredThreadResult(session, "q-42", session.state.threadMonitoring!.threads["q-42"].pending!.id);
    session.messageHistory.push(structuredClone(session.messageHistory[0]));
    const restored = structuredClone(session);
    expect(recordMonitoredThreadResult(restored, first)).toBe(false);
    expect(recordMonitoredThreadResult(restored, { ...second, summary: "Edited summary" })).toBe(false);
    expect(buildThreadMonitoringProjection(restored).pendingCount).toBe(0);
  });

  it("leaves tracking quiet on Waiting and rejects Ready while input is unresolved", () => {
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    publish(session, "waiting", "Waiting");
    session.notifications.push({
      id: "n-1",
      category: "needs-input",
      timestamp: 1,
      threadKey: "q-42",
      messageId: null,
      done: false,
    });
    expect(publish(session, "blocked")).toEqual([]);
    expect(buildThreadMonitoringProjection(session).pendingCount).toBe(0);
    session.notifications[0].done = true;
    publish(session, "ready");
    session.notifications[0].done = false;
    expect(buildThreadMonitoringProjection(session).pendingCount).toBe(1);
    expect(session.notifications[0].done).toBe(false);
  });

  it("stops tracking explicitly and permits deliberate re-tracking of the current Ready", () => {
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    publish(session, "first");
    setThreadMonitoring(session, "q-42", false);
    publish(session, "second");
    expect(buildThreadMonitoringProjection(session)).toMatchObject({ trackedCount: 0, pendingCount: 0 });
    setThreadMonitoring(session, "q-42", true);
    expect(session.state.threadMonitoring?.threads["q-42"].pending?.messageId).toBe("second");
  });

  it("preserves global counts when more than fifty monitored tabs exist", () => {
    const session = fixture();
    for (let index = 1; index <= 75; index++) {
      const key = `q-${index}`;
      setThreadMonitoring(session, key, true);
      publish(session, `ready-${index}`, "Ready", key);
    }
    session.state.leaderOpenThreadTabs!.orderedOpenThreadKeys = Array.from(
      { length: 50 },
      (_, index) => `q-${index + 1}`,
    );
    const projection = buildThreadMonitoringProjection(session);
    expect(projection.pendingCount).toBe(75);
    expect(Object.keys(projection.threads)).toHaveLength(50);
    expect(isThreadMonitoringProjectionValue(projection)).toBe(true);
  });
});

describe("reminders in Notify Me", () => {
  it("puts Main in Notify Me for a reminder and drops it once acknowledged, while a quest stays tracked", () => {
    // Notify Me tracks quest tabs only, so Main's monitor lives only while its reminder waits.
    const session = fixture();
    expect(setThreadMonitoring(session, "main", true)).toBe(false);
    expect(recordReminderResult(session, "main", "Reminder: Main", 5)).toBe(true);
    expect(recordReminderResult(session, "q-42", "Reminder: q-42", 5)).toBe(true);
    const projection = buildThreadMonitoringProjection(session);
    expect(projection.threads).toEqual({ main: { pendingResultId: "1" }, "q-42": { pendingResultId: "2" } });
    expect(isThreadMonitoringProjectionValue(projection)).toBe(true);

    expect(acknowledgeMonitoredThreadResult(session, "main", "1")).toBe(true);
    expect(acknowledgeMonitoredThreadResult(session, "q-42", "2")).toBe(true);
    expect(Object.keys(session.state.threadMonitoring!.threads)).toEqual(["q-42"]);
  });
});

describe("where a Notify Me result opens", () => {
  // A leader often puts the Ready marker in a closing commentary line ("The result is reported
  // above...") after its answer. The result must open at that answer, the final message the user
  // waits for, not at the commentary holding the marker. The stored result keeps the Ready message;
  // monitoredResultMessageId resolves where it opens, so results recorded before this still do.
  function answer(session: ReturnType<typeof fixture>, id: string, threadKey = "q-42") {
    session.messageHistory.push({
      type: "assistant",
      timestamp: session.messageHistory.length + 1,
      parent_tool_use_id: null,
      threadKey,
      questId: threadKey,
      leaderThreadRole: "answer",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "The relaunch fixed it." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    } as Assistant);
  }
  function report(session: ReturnType<typeof fixture>, id: string) {
    session.messageHistory.push({
      type: "markdown_report",
      id,
      content: "# Assessment",
      timestamp: session.messageHistory.length + 1,
      threadKey: "q-42",
      questId: "q-42",
    } as BrowserIncomingMessage);
  }
  const opensAt = (session: ReturnType<typeof fixture>) =>
    monitoredResultMessageId(session, "q-42", session.state.threadMonitoring!.threads["q-42"].pending!);
  const acknowledge = (session: ReturnType<typeof fixture>) =>
    acknowledgeMonitoredThreadResult(session, "q-42", session.state.threadMonitoring!.threads["q-42"].pending!.id);

  it("opens a result at the answer before its Ready commentary, and at a later report over it", () => {
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    answer(session, "answer-1");
    publish(session, "ready-commentary-1");
    expect(session.state.threadMonitoring!.threads["q-42"].pending!.messageId).toBe("ready-commentary-1");
    expect(opensAt(session)).toBe("answer-1");

    acknowledge(session);
    answer(session, "answer-2");
    report(session, "report-2");
    publish(session, "ready-commentary-2");
    expect(opensAt(session)).toBe("report-2");
  });

  it("opens at the Ready message when nothing was answered in the thread since the previous result", () => {
    // A status-only Ready ("worker dispatched") must not reopen an answer an earlier result already
    // pointed at, nor an answer written in another thread.
    const session = fixture();
    setThreadMonitoring(session, "q-42", true);
    answer(session, "old-answer");
    publish(session, "ready-1");
    acknowledge(session);
    answer(session, "other-thread-answer", "q-7");
    publish(session, "ready-2");
    expect(opensAt(session)).toBe("ready-2");
  });

  it("opens a captured result and a due reminder at the answer, and a reminder set from a message there", () => {
    const captured = fixture();
    answer(captured, "answer-1");
    publish(captured, "ready-commentary");
    setThreadMonitoring(captured, "q-42", true);
    expect(opensAt(captured)).toBe("answer-1");

    const reminded = fixture();
    answer(reminded, "answer-1");
    publish(reminded, "ready-commentary");
    recordReminderResult(reminded, "q-42", "Reminder", 50);
    expect(opensAt(reminded)).toBe("answer-1");

    const fromMessage = fixture();
    answer(fromMessage, "answer-1");
    answer(fromMessage, "answer-2");
    publish(fromMessage, "ready-commentary");
    recordReminderResult(fromMessage, "q-42", "Reminder", 50, "answer-1");
    expect(opensAt(fromMessage)).toBe("answer-1");
  });
});
