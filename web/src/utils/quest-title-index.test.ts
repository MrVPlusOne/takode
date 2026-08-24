import { describe, expect, it } from "vitest";
import type { QuestTitlePreview, QuestmasterTask } from "../types.js";
import { applyCanonicalQuestTitles, buildCanonicalQuestTitleIndex } from "./quest-title-index.js";

function quest(questId: string, title: string, version = 1, updatedAt = version): QuestmasterTask {
  return {
    id: `${questId}-v${version}`,
    questId,
    version,
    title,
    description: "Test quest",
    status: "done",
    createdAt: 1,
    updatedAt,
    completedAt: 2,
    verificationItems: [],
  } as QuestmasterTask;
}

describe("canonical quest title index", () => {
  it("prefers newer targeted canonical records and upgrades fallback rows", () => {
    const preview: QuestTitlePreview = {
      questId: "q-1932",
      title: "Resolve VSCode QA Stack Conflicts",
      version: 3,
      updatedAt: 30,
    };
    const titles = buildCanonicalQuestTitleIndex({
      quests: [quest("q-1932", "Older canonical title", 2, 20)],
      questDetails: new Map([["q-1932", quest("q-1932", "q-1932", 3, 25)]]),
      questTitlePreviews: new Map([["q-1932", preview]]),
    });

    expect(titles.get("q-1932")).toBe("Resolve VSCode QA Stack Conflicts");
    expect(applyCanonicalQuestTitles([{ threadKey: "q-1932", questId: "q-1932", title: "q-1932" }], titles)).toEqual([
      { threadKey: "q-1932", questId: "q-1932", title: "Resolve VSCode QA Stack Conflicts" },
    ]);
  });

  it("treats an explicit missing projection as a tombstone for stale browser caches", () => {
    const titles = buildCanonicalQuestTitleIndex({
      quests: [quest("q-1932", "Stale list title", 2, 20)],
      questDetails: new Map([["q-1932", quest("q-1932", "Stale detail title", 3, 30)]]),
      questTitlePreviews: new Map([["q-1932", null]]),
    });

    expect(titles.has("q-1932")).toBe(false);
  });
});
