// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { threadStatusMessageIdHash } from "../../shared/thread-status-marker.js";
import { createLeaderThreadTabsProjectionValue } from "../test-fixtures/leader-thread-tabs-projection.js";
import type { ChatMessage } from "../types.js";
import { buildFeedModel } from "./use-feed-model.js";
import { useCollapsePolicy } from "./use-collapse-policy.js";

const storeMocks = vi.hoisted(() => ({
  overridesBySession: new Map<string, Map<string, boolean>>(),
  syncedProjectionValues: new Map<string, unknown>(),
  syncedProjectionKeys: new Set<string>(),
  toggleTurnActivity: vi.fn(),
}));

vi.mock("../store.js", () => ({
  useStore: (
    selector: (state: {
      syncedProjectionValues: typeof storeMocks.syncedProjectionValues;
      syncedProjectionKeys: typeof storeMocks.syncedProjectionKeys;
      turnActivityOverrides: Map<string, Map<string, boolean>>;
      toggleTurnActivity: typeof storeMocks.toggleTurnActivity;
    }) => unknown,
  ) =>
    selector({
      syncedProjectionValues: storeMocks.syncedProjectionValues,
      syncedProjectionKeys: storeMocks.syncedProjectionKeys,
      turnActivityOverrides: storeMocks.overridesBySession,
      toggleTurnActivity: storeMocks.toggleTurnActivity,
    }),
}));

function makeMessage(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage["role"] }): ChatMessage {
  return {
    content: "",
    timestamp: 1,
    ...overrides,
  };
}

function makeInjectedUserMessage(id: string, content: string, sessionId: string, timestamp: number): ChatMessage {
  return makeMessage({
    id,
    role: "user",
    content,
    timestamp,
    agentSource: { sessionId },
  });
}

function installLeaderProjection(threadStatuses: LeaderThreadTabsProjectionValue["threadStatuses"]) {
  const sessionId = "leader-session";
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, sessionId);
  storeMocks.syncedProjectionValues.set(
    entryId,
    createLeaderThreadTabsProjectionValue({
      tabs: [],
      mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
      threadStatuses,
      activePhaseSummary: [],
    }),
  );
  storeMocks.syncedProjectionKeys.add(entryId);
}

function getLeaderCollapseStates(messages: ChatMessage[], autoCollapseReadyThreadKey?: string | null) {
  const model = buildFeedModel(messages, true);
  const { result } = renderHook(() =>
    useCollapsePolicy({
      autoCollapseReadyThreadKey,
      sessionId: "leader-session",
      turns: model.turns,
    }),
  );
  return result.current.turnStates.map(({ turnId, defaultExpanded, isActivityExpanded }) => ({
    turnId,
    defaultExpanded,
    isActivityExpanded,
  }));
}

describe("useCollapsePolicy", () => {
  beforeEach(() => {
    storeMocks.overridesBySession.clear();
    storeMocks.syncedProjectionValues.clear();
    storeMocks.syncedProjectionKeys.clear();
    storeMocks.toggleTurnActivity.mockClear();
  });

  it("keeps the current leader turn expanded when only generated activity follows it", () => {
    // Generated user-shaped records carry agentSource, so they should stay
    // inside the active leader turn and must not collapse it automatically.
    const states = getLeaderCollapseStates([
      makeMessage({ id: "u1", role: "user", content: "launch now", timestamp: 1 }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        timestamp: 2,
        contentBlocks: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "takode send" } }],
      }),
      makeInjectedUserMessage("herd-1", "#1456 | turn_end | ✓ 50s", "herd-events", 3),
      makeInjectedUserMessage("timer-1", "[Timer] monitor rollout", "timer:rollout", 4),
      makeInjectedUserMessage("system-1", "[System reminder] use thread marker", "system:thread-routing", 5),
      makeInjectedUserMessage("worker-1", "Worker finished Execute", "worker-session", 6),
      makeMessage({
        id: "transition-1",
        role: "system",
        content: "Work continued from thread:q-1144 to thread:q-1141",
        timestamp: 7,
      }),
      makeMessage({ id: "a-status", role: "assistant", content: "q-1144 is launched and writing.", timestamp: 8 }),
    ]);

    expect(states).toEqual([{ turnId: "u1", defaultExpanded: true, isActivityExpanded: true }]);
  });

  it("collapses only the previous leader turn after a later real human user message", () => {
    // A user-role message without agentSource is the canonical human boundary:
    // it closes the prior turn while leaving the new active turn expanded.
    const states = getLeaderCollapseStates([
      makeMessage({ id: "u1", role: "user", content: "launch now", timestamp: 1 }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        timestamp: 2,
        contentBlocks: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "takode send" } }],
      }),
      makeInjectedUserMessage("timer-1", "[Timer] monitor rollout", "timer:rollout", 3),
      makeMessage({ id: "a-status", role: "assistant", content: "Still monitoring the rollout.", timestamp: 4 }),
      makeMessage({ id: "u2", role: "user", content: "pause if errors increase", timestamp: 5 }),
      makeMessage({ id: "a2", role: "assistant", content: "Watching the error rate.", timestamp: 6 }),
    ]);

    expect(states).toEqual([
      { turnId: "u1", defaultExpanded: false, isActivityExpanded: false },
      { turnId: "u2", defaultExpanded: true, isActivityExpanded: true },
    ]);
  });

  it("collapses the current selected leader turn when it carries the current Ready status", () => {
    const readyStatus = {
      kind: "ready",
      label: "Thread Ready",
      threadKey: "q-1636",
      questId: "q-1636",
      summary: "complete",
      messageId: "a-ready",
      timestamp: 3,
      updatedAt: 3,
    } as const;
    installLeaderProjection({ "q-1636": readyStatus });

    const states = getLeaderCollapseStates(
      [
        makeMessage({ id: "u1", role: "user", content: "close q-1636", timestamp: 1 }),
        makeMessage({ id: "a-private", role: "assistant", content: "Checking final state.", timestamp: 2 }),
        makeMessage({
          id: "a-ready",
          role: "assistant",
          content: "q-1636 is complete.",
          timestamp: 3,
          metadata: {
            threadRefs: [{ threadKey: "q-1636", questId: "q-1636", source: "explicit" }],
            threadStatusMarkers: [readyStatus],
          },
        }),
      ],
      "q-1636",
    );

    expect(states).toEqual([{ turnId: "u1", defaultExpanded: false, isActivityExpanded: false }]);
  });
  it("correlates a compacted Ready status through its full message ID hash", () => {
    const fullMessageId = `ready-${"m".repeat(190)}`;
    const projectedStatus = {
      kind: "ready",
      label: "Thread Ready",
      threadKey: "q-1636",
      questId: "q-1636",
      summary: "",
      messageId: "",
      messageIdHash: threadStatusMessageIdHash(fullMessageId),
      timestamp: 3,
      updatedAt: 3,
    } as const;
    installLeaderProjection({ "q-1636": projectedStatus });

    const states = getLeaderCollapseStates(
      [
        makeMessage({ id: "u1", role: "user", content: "close q-1636", timestamp: 1 }),
        makeMessage({
          id: fullMessageId,
          role: "assistant",
          content: "q-1636 is complete.",
          timestamp: 3,
          metadata: {
            threadRefs: [{ threadKey: "q-1636", questId: "q-1636", source: "explicit" }],
          },
        }),
      ],
      "q-1636",
    );

    expect(states).toEqual([{ turnId: "u1", defaultExpanded: false, isActivityExpanded: false }]);
  });
});
