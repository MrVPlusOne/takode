import { describe, expect, it } from "vitest";
import type { ChatMessage, ThreadWindowState } from "../types.js";
import { buildFeedModel } from "../hooks/use-feed-model.js";
import { buildFeedMessageModel } from "./feed-render-model.js";

function message(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage["role"] }): ChatMessage {
  return { content: "", timestamp: 1, ...overrides };
}

function selectedWindow(threadKey: string): ThreadWindowState {
  return {
    thread_key: threadKey,
    from_item: 0,
    item_count: 3,
    total_items: 3,
    source_history_length: 20,
    section_item_count: 50,
    visible_item_count: 3,
  };
}

function statusOnly(id: string, threadKey: string, historyIndex?: number): ChatMessage {
  return message({
    id,
    role: "assistant",
    content: "",
    contentBlocks: [{ type: "text", text: "" }],
    turnDurationMs: 18_253,
    ...(historyIndex === undefined ? {} : { historyIndex }),
    metadata: {
      threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
      threadStatusMarkers: [
        {
          kind: "waiting",
          label: "Thread Waiting",
          threadKey,
          questId: threadKey,
          summary: "calculating cache ETA",
          messageId: id,
          timestamp: 1,
          updatedAt: 1,
        },
      ],
    },
  });
}

function buildProjection(threadKey: string, allMessages: ChatMessage[], windowMessages: ChatMessage[] = []) {
  const selected = threadKey === "q-1869" ? selectedWindow(threadKey) : null;
  return buildFeedMessageModel({
    leaderSessionId: "leader-1",
    threadKey,
    projectThreadRoutes: true,
    allMessages,
    historyLoading: false,
    selectedFeedWindowEnabled: selected !== null,
    selectedFeedWindow: selected,
    selectedFeedWindowMessages: windowMessages,
  });
}

describe("post-processed assistant renderability in feed projections", () => {
  it("keeps raw selected-window identity while excluding an empty host from presentation", () => {
    const emptyStatus = statusOnly("status-only", "q-1869", 10);
    const visible = message({
      id: "visible-answer",
      role: "assistant",
      content: "ETA is 24–36 hours.",
      contentBlocks: [{ type: "text", text: "ETA is 24–36 hours." }],
      historyIndex: 11,
      metadata: { threadRefs: [{ threadKey: "q-1869", questId: "q-1869", source: "explicit" }] },
    });
    const projected = buildProjection("q-1869", [], [emptyStatus, visible]);
    const turn = buildFeedModel(projected.messages, true).turns[0];

    expect(projected.messages.map((item) => item.id)).toEqual(["status-only", "visible-answer"]);
    expect(turn.allEntries.flatMap((entry) => (entry.kind === "message" ? [entry.msg.id] : []))).toContain(
      "status-only",
    );
    expect(turn.agentEntries.flatMap((entry) => (entry.kind === "message" ? [entry.msg.id] : []))).not.toContain(
      "status-only",
    );
    expect(turn.collapsedEntries?.map((entry) => entry.key).join(" ")).not.toContain("status-only");
  });

  it("applies the same empty-host rule in aggregate and ordinary-role feed models", () => {
    const emptyStatus = statusOnly("status-only", "q-1869");
    const projected = buildProjection("all", [emptyStatus]);

    for (const leaderMode of [false, true]) {
      const turn = buildFeedModel(projected.messages, leaderMode).turns[0];
      expect(turn.allEntries).toHaveLength(1);
      expect(turn.agentEntries).toEqual([]);
      expect(turn.collapsedEntries).toEqual([]);
      expect(turn.stats).toEqual({ messageCount: 0, toolCount: 0, subagentCount: 0, herdEventCount: 0 });
    }
  });

  it("preserves notification and side-chat children even when prose is empty", () => {
    const empty = message({ id: "child-host", role: "assistant", content: "", contentBlocks: [] });

    expect(buildFeedModel([empty], true, 0, ["child-host"]).turns[0].agentEntries).toHaveLength(0);
    expect(buildFeedModel([empty], true, 0, [], null, ["child-host"]).turns[0].agentEntries).toHaveLength(1);
  });
});
