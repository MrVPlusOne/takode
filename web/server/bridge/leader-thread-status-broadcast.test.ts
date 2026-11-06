import { afterEach, describe, expect, it, vi } from "vitest";
import { parseThreadStatusMarkerLine, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { SessionNotification } from "../session-types.js";
import { installLeaderThreadStatusBroadcast } from "./leader-thread-status-broadcast.js";
import {
  clearLeaderReadyStatusesBlockedByNeedsInput,
  clearLeaderThreadStatusForActivity,
  setLeaderThreadStatusChangeListener,
  updateLeaderThreadStatusesForAssistantOutput,
} from "./thread-routing-reminder.js";

// Every change of a leader's thread statuses goes to its browsers as it happens, whichever path
// changed it: a marker, new activity in the thread, or a question that blocks a Ready. The
// browser's feed shows its thread's status from these updates and from the thread's window.

afterEach(() => setLeaderThreadStatusChangeListener(null));

function leader() {
  return {
    id: "leader",
    messageHistory: [] as BrowserIncomingMessage[],
    notifications: [] as SessionNotification[],
    state: { leaderThreadStatuses: {} as Record<string, LeaderThreadStatus> },
  };
}

function install(session: ReturnType<typeof leader>) {
  const sent: BrowserIncomingMessage[] = [];
  const invalidate = vi.fn(() => true);
  installLeaderThreadStatusBroadcast({
    getSession: (id) => (id === session.id ? session : undefined),
    broadcastToBrowsers: (_session, message) => sent.push(message),
    getSyncedProjectionController: () => ({ invalidateLeaderThreadTabsForSession: invalidate }),
  });
  return { sent, invalidate };
}

describe("leader thread status broadcast", () => {
  it("sends each status set or cleared to the leader's browsers and refreshes its tabs", () => {
    const session = leader();
    const { sent, invalidate } = install(session);
    const marker = parseThreadStatusMarkerLine("{[(Thread Waiting: topic:9c206818 | numbers coming)]}")!;

    updateLeaderThreadStatusesForAssistantOutput(session, [marker], { messageId: "a-1", timestamp: 10 });
    expect(sent).toEqual([
      {
        type: "leader_thread_status",
        thread_key: "topic:9c206818",
        status: expect.objectContaining({
          kind: "waiting",
          summary: "numbers coming",
          messageId: "a-1",
          // The full message ID's hash, which tells the browser the ID is complete.
          messageIdHash: expect.stringMatching(/^[0-9a-f]{32}$/),
        }),
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith("leader");

    // New leader activity in the thread clears its status.
    clearLeaderThreadStatusForActivity(session, { threadKey: "topic:9c206818" }, { messageId: "a-2", timestamp: 20 });
    expect(sent.at(-1)).toEqual({ type: "leader_thread_status", thread_key: "topic:9c206818", status: null });
  });

  it("sends a Ready cleared by an open question, a path that changes no projection on its own", () => {
    const session = leader();
    session.state.leaderThreadStatuses["q-7"] = {
      kind: "ready",
      label: "Thread Ready",
      threadKey: "q-7",
      questId: "q-7",
      summary: "done",
      messageId: "a-ready",
      timestamp: 5,
      updatedAt: 5,
    };
    session.notifications.push({
      id: "n-1",
      category: "needs-input",
      summary: "Which cap?",
      timestamp: 6,
      messageId: "a-question",
      threadKey: "q-7",
      questId: "q-7",
      done: false,
    });
    const { sent } = install(session);

    expect(clearLeaderReadyStatusesBlockedByNeedsInput(session)).toBe(true);
    expect(sent).toEqual([{ type: "leader_thread_status", thread_key: "q-7", status: null }]);
  });
});
