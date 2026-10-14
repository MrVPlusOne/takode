import { describe, expect, it } from "vitest";
import { buildRecentSessionNodes, sessionInteractionAt } from "./recent-sessions.js";
import type { SidebarSessionItem } from "./sidebar-session-item.js";
import type { TreeViewGroupData } from "./tree-grouping.js";

function session(id: string, overrides: Partial<SidebarSessionItem> = {}): SidebarSessionItem {
  return {
    id,
    model: "",
    cwd: "/repo",
    gitBranch: "",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "idle",
    sdkState: "connected",
    createdAt: 0,
    archived: false,
    backendType: "claude-sdk",
    repoRoot: "/repo",
    permCount: 0,
    ...overrides,
  };
}

function space(id: string, nodes: TreeViewGroupData["nodes"]): TreeViewGroupData {
  return { id, name: id.toUpperCase(), nodes, runningCount: 0, permCount: 0, unreadCount: 0 };
}

describe("buildRecentSessionNodes", () => {
  it("merges every space's cards into one list, newest interaction first, keeping herds and spaces", () => {
    // The Recent view ignores space boundaries for order but must still say which space each card is in.
    const groups = [
      space("takode", [
        { leader: session("old-leader", { lastUserMessageAt: 100 }), workers: [], reviewers: [] },
        {
          leader: session("herd-leader", { lastUserMessageAt: 50 }),
          // Answering a worker's question counts for the card, so this herd is the newest.
          workers: [session("worker", { createdAt: 20, lastUserMessageAt: 900 })],
          reviewers: [],
        },
      ]),
      space("msi", [
        { leader: session("asked", { lastUserMessageAt: 10, lastAttentionAt: 500 }), workers: [], reviewers: [] },
      ]),
      // A session the user created but never messaged still counts its creation.
      space("personal", [{ leader: session("created", { createdAt: 300 }), workers: [], reviewers: [] }]),
    ];

    const nodes = buildRecentSessionNodes(groups);

    expect(nodes.map((node) => [node.leader.id, node.spaceName, node.recentAt])).toEqual([
      ["herd-leader", "TAKODE", 900],
      ["asked", "MSI", 500],
      ["created", "PERSONAL", 300],
      ["old-leader", "TAKODE", 100],
    ]);
    expect(nodes[0].workers.map((worker) => worker.id)).toEqual(["worker"]);
  });
});

describe("sessionInteractionAt", () => {
  it("takes the later of the user's last message and the session last asking for the user", () => {
    expect(sessionInteractionAt(session("a", { lastUserMessageAt: 200, lastAttentionAt: 100 }))).toBe(200);
    expect(sessionInteractionAt(session("b", { lastUserMessageAt: 100, lastAttentionAt: 200 }))).toBe(200);
    expect(sessionInteractionAt(session("c"))).toBe(0);
  });
});
