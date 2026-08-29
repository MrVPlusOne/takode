import { describe, expect, it } from "vitest";
import type { QuestmasterTask } from "../types.js";
import { rankQuestsBySearchRelevance } from "./quest-search-ranking.js";

function quest(questId: string, title: string, feedback: QuestmasterTask["feedback"]): QuestmasterTask {
  return {
    id: `${questId}-v1`,
    questId,
    version: 1,
    title,
    createdAt: 1,
    status: "refined",
    description: "No matching description.",
    feedback,
  } as QuestmasterTask;
}

describe("rankQuestsBySearchRelevance feedback tombstones", () => {
  it("ignores deleted feedback text while retaining live feedback search", () => {
    const deletedOnly = quest("q-1", "Deleted only", [{ author: "agent", text: "hidden-needle", ts: 1, deletedAt: 2 }]);
    const live = quest("q-2", "Live feedback", [{ author: "agent", text: "visible needle", ts: 3 }]);

    expect(rankQuestsBySearchRelevance([deletedOnly, live], "needle").map((item) => item.questId)).toEqual(["q-2"]);
  });
});
