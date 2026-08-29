import { describe, expect, it } from "vitest";
import {
  indexedLiveQuestFeedbackEntries,
  isDeletedQuestFeedbackEntry,
  liveQuestFeedbackEntries,
  liveQuestFeedbackEntryAt,
  tombstoneQuestFeedbackEntry,
} from "./quest-feedback.js";
import type { QuestFeedbackEntry } from "../server/quest-types.js";

describe("quest feedback tombstones", () => {
  it("preserves raw indices while excluding deleted slots from live semantics", () => {
    const entries: QuestFeedbackEntry[] = [
      { author: "human", text: "First", ts: 1 },
      { author: "human", text: "", ts: 2, deletedAt: 3 },
      { author: "agent", text: "Third", ts: 4 },
    ];

    expect(liveQuestFeedbackEntries(entries).map((entry) => entry.text)).toEqual(["First", "Third"]);
    expect(indexedLiveQuestFeedbackEntries(entries).map(({ index, text }) => ({ index, text }))).toEqual([
      { index: 0, text: "First" },
      { index: 2, text: "Third" },
    ]);
    expect(liveQuestFeedbackEntryAt(entries, 1)).toBeUndefined();
    expect(liveQuestFeedbackEntryAt(entries, 2)?.text).toBe("Third");
  });

  it("clears deleted content and attachment metadata without shifting the slot", () => {
    const entry: QuestFeedbackEntry = {
      entryId: "feedback-stable-id",
      author: "agent",
      text: "Sensitive body",
      tldr: "Sensitive summary",
      ts: 10,
      authorSessionId: "session-1",
      images: [{ id: "img-1", filename: "proof.png", mimeType: "image/png", path: "/tmp/proof.png" }],
      phaseId: "work",
      phasePosition: 2,
    };

    const tombstone = tombstoneQuestFeedbackEntry(entry, 20);

    expect(tombstone).toEqual({
      entryId: "feedback-stable-id",
      author: "agent",
      text: "",
      ts: 10,
      deletedAt: 20,
    });
    expect(isDeletedQuestFeedbackEntry(tombstone)).toBe(true);
  });
});
