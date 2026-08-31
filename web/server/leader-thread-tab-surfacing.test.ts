import { describe, expect, it, vi } from "vitest";
import { MAX_LEADER_OPEN_THREAD_TABS } from "../shared/leader-open-thread-tabs.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import type { ThreadTransitionMarker } from "./session-types.js";
import { WsBridge } from "./ws-bridge.js";

function transitionMarker(
  sourceThreadKey = "q-1001",
  threadKey = "q-1002",
  overrides: Partial<ThreadTransitionMarker> = {},
): ThreadTransitionMarker {
  return {
    type: "thread_transition_marker",
    id: `transition-${sourceThreadKey}-${threadKey}`,
    timestamp: 100,
    markerKey: `thread-transition:${sourceThreadKey}->${threadKey}:1`,
    sourceThreadKey,
    ...(sourceThreadKey.startsWith("q-") ? { sourceQuestId: sourceThreadKey } : {}),
    threadKey,
    questId: threadKey,
    transitionedAt: 100,
    reason: "route_switch",
    sourceMessageIndex: 1,
    targetThreadFreshness: "new_quest_thread",
    ...overrides,
  };
}

function viewingSocket(sessionId: string, threadKey: string, currentBuild = true) {
  return {
    data: {
      kind: "browser",
      sessionId,
      boundedConversation: currentBuild,
      ...(currentBuild
        ? {
            conversationView: {
              kind: "thread",
              request: { threadKey },
            },
          }
        : {}),
    },
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as any;
}

function leaderBridge(id = "leader") {
  const bridge = new WsBridge();
  const leader = bridge.getOrCreateSession(id);
  leader.state.isOrchestrator = true;
  return { bridge, leader };
}

describe("server-owned leader thread tab surfacing", () => {
  it("surfaces a fresh transition in the background when a current browser views its normal source", () => {
    const { bridge, leader } = leaderBridge();
    const sourceViewer = viewingSocket(leader.id, "q-1001");
    leader.browserSockets.add(sourceViewer);

    expect(bridge.promoteLeaderThreadTabForTransition(leader.id, transitionMarker())).toBe(true);
    expect(leader.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1002"]);
    expect(sourceViewer.data.conversationView.request.threadKey).toBe("q-1001");
    expect(sourceViewer.send).not.toHaveBeenCalled();
  });

  it("requires new target freshness and one matching current-build source view, never All", () => {
    const { bridge, leader } = leaderBridge();
    leader.browserSockets.add(viewingSocket(leader.id, "q-9999"));
    leader.browserSockets.add(viewingSocket(leader.id, "q-1001", false));
    leader.browserSockets.add({
      ...viewingSocket(leader.id, "main"),
      data: {
        kind: "browser",
        sessionId: leader.id,
        boundedConversation: true,
        conversationView: { kind: "history", request: {} },
      },
    } as any);

    expect(bridge.promoteLeaderThreadTabForTransition(leader.id, transitionMarker())).toBe(false);
    expect(
      bridge.promoteLeaderThreadTabForTransition(
        leader.id,
        transitionMarker("q-9999", "q-1002", { targetThreadFreshness: "existing_quest_thread" }),
      ),
    ).toBe(false);
    expect(bridge.promoteLeaderThreadTabForTransition(leader.id, transitionMarker("all", "q-1002"))).toBe(false);
    expect(leader.state.leaderOpenThreadTabs).toBeUndefined();
  });

  it("uses any matching browser once and converges every browser through one durable mutation", () => {
    const { bridge, leader } = leaderBridge();
    const first = viewingSocket(leader.id, "main");
    const second = viewingSocket(leader.id, "q-elsewhere");
    leader.browserSockets.add(first);
    leader.browserSockets.add(second);
    const marker = transitionMarker("main", "q-1002");

    expect(bridge.promoteLeaderThreadTabForTransition(leader.id, marker)).toBe(true);
    expect(bridge.promoteLeaderThreadTabForTransition(leader.id, marker)).toBe(false);
    expect(leader.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1002"]);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).not.toHaveBeenCalled();
  });

  it("surfaces each new attachment once while preserving tombstone and event freshness", () => {
    const { bridge, leader } = leaderBridge();
    leader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-1002", closedAt: 100 }],
      updatedAt: 100,
      explicitOrderUpdatedAt: 100,
    };

    expect(bridge.promoteLeaderThreadTabForAttachment(leader.id, "q-1002", 90)).toBe(false);
    expect(bridge.promoteLeaderThreadTabForAttachment(leader.id, "q-1002", 110)).toBe(true);
    expect(bridge.promoteLeaderThreadTabForAttachment(leader.id, "q-1002", 110)).toBe(false);
    expect(leader.state.leaderOpenThreadTabs).toMatchObject({
      orderedOpenThreadKeys: ["q-1002"],
      closedThreadTombstones: [],
      serverCandidatePromotedAt: { "q-1002": 110 },
    });
  });

  it("excludes scheduled and completed targets and never evicts a tab at capacity", () => {
    const { bridge, leader } = leaderBridge();
    leader.board.set("q-scheduled", {
      questId: "q-scheduled",
      status: "QUEUED",
      createdAt: 1,
      updatedAt: 1,
    });
    leader.completedBoard.set("q-completed", {
      questId: "q-completed",
      status: "MEMORY",
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
    });

    expect(bridge.promoteLeaderThreadTabForAttachment(leader.id, "q-scheduled", 100)).toBe(false);
    expect(bridge.promoteLeaderThreadTabForAttachment(leader.id, "q-completed", 100)).toBe(false);

    const full = Array.from({ length: MAX_LEADER_OPEN_THREAD_TABS }, (_, index) => `q-${index + 1}`);
    leader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: full,
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    expect(bridge.promoteLeaderThreadTabForAttachment(leader.id, "q-9999", 101)).toBe(false);
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(full);
  });

  it("does not process retained transition markers during projection snapshot derivation", () => {
    const { bridge, leader } = leaderBridge();
    leader.messageHistory.push(transitionMarker());
    leader.browserSockets.add(viewingSocket(leader.id, "q-1001"));

    expect(bridge.getSyncedProjectionController().getSnapshot(LEADER_THREAD_TABS_PROJECTION, leader.id)).not.toBeNull();
    expect(leader.state.leaderOpenThreadTabs).toBeUndefined();
  });
});
