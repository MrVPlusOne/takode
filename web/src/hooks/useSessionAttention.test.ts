// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { LEADER_THREAD_TABS_PROJECTION } from "../../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { useSessionAttention } from "./useSessionAttention.js";

const review = (id: string, threadKey: string, timestamp: number) =>
  ({
    id,
    category: "review",
    threadKey,
    timestamp,
    messageId: `m-${id}`,
    summary: id,
    done: false,
  }) as SessionNotification;

beforeEach(() => {
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, "leader");
  useStore.setState({
    sdkSessions: [{ sessionId: "leader", state: "connected", cwd: "/", createdAt: 1, isOrchestrator: true }] as never,
    syncedProjectionKeys: new Set([entryId]),
    syncedProjectionValues: new Map([
      [
        entryId,
        {
          currentQuestStateVersion: 1,
          tabState: null,
          tabs: [
            {
              threadKey: "q-1",
              questId: "q-1",
              title: "Relay",
              attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: true, updatedAt: 10 },
            },
          ],
          mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
          threadStatuses: {},
          activePhaseSummary: [],
        },
      ],
    ]),
    sessionNotifications: new Map([["leader", [review("quest", "q-1", 10), review("thread", "topic:55badbba", 20)]]]),
  });
});

describe("useSessionAttention", () => {
  it("counts unread answers in user threads and topic conversations, which have no tab", () => {
    // A leader's feed chip (the desktop top bar's Next) is the only place showing that a thread
    // the user started has a new answer; built from tabs alone it skipped them.
    const { result } = renderHook(() => useSessionAttention("leader", []));
    expect(result.current.queue.map((item) => item.threadKey)).toEqual(["topic:55badbba", "q-1"]);
  });
});
