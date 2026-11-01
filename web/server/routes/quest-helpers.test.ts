import { describe, expect, it, vi } from "vitest";
import { broadcastQuestUpdate } from "./quest-helpers.js";
import type { QuestmasterTask } from "../quest-types.js";

describe("broadcastQuestUpdate", () => {
  it("routes quest invalidations through the global non-buffering fanout path", () => {
    const broadcastGlobal = vi.fn();
    const broadcastToBrowsers = vi.fn();
    const wsBridge = {
      broadcastGlobal,
      broadcastToBrowsers,
      sessions: new Map([["s1", {}]]),
    };

    broadcastQuestUpdate(wsBridge as unknown as Parameters<typeof broadcastQuestUpdate>[0]);

    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
    expect(broadcastGlobal).toHaveBeenCalledWith({ type: "quest_list_updated" });
    expect(broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("includes a bounded exact quest projection when the updated record is available", () => {
    const broadcastGlobal = vi.fn();
    const wsBridge = { broadcastGlobal };
    const quest = {
      id: "q-42",
      questId: "q-42",
      version: 5,
      title: "Attach Work commits before Memory",
      status: "in_progress",
      description: "Keep code evidence visible during Memory.",
      createdAt: 10,
      statusChangedAt: 60,
      updatedAt: 50,
      commitShas: ["abc1234", "def5678"],
      sessionId: "worker-1",
      claimedAt: 20,
    } as QuestmasterTask;

    broadcastQuestUpdate(wsBridge as unknown as Parameters<typeof broadcastQuestUpdate>[0], quest);

    expect(broadcastGlobal).toHaveBeenCalledWith({
      type: "quest_list_updated",
      quest: {
        questId: "q-42",
        title: "Attach Work commits before Memory",
        version: 5,
        updatedAt: 60,
        commitShas: ["abc1234", "def5678"],
      },
    });
  });

  // A reopen's broadcast carries the newest round's title, so thread rows and strips in every
  // browser switch to it without fetching the quest.
  it("carries a reopened quest's newest round title", () => {
    const broadcastGlobal = vi.fn();
    const quest = {
      id: "q-43",
      questId: "q-43",
      version: 7,
      title: "Desktop workspace",
      status: "refined",
      description: "Standing brief.",
      createdAt: 10,
      rounds: [
        { openedAt: 10, closedAt: 40 },
        { openedAt: 50, title: "Side column limit" },
      ],
    } as QuestmasterTask;

    broadcastQuestUpdate({ broadcastGlobal } as unknown as Parameters<typeof broadcastQuestUpdate>[0], quest);

    expect(broadcastGlobal.mock.calls[0]![0].quest).toMatchObject({
      title: "Desktop workspace",
      roundTitle: "Side column limit",
    });
  });
});
