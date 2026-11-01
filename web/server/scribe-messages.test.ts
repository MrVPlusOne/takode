import { describe, expect, it } from "vitest";
import { reminderMessage, updateMessage, type UpdateContent } from "./scribe-messages.js";

const leader = { sessionNum: 7, name: "Daily" };
const at = Date.UTC(2026, 10, 1, 18);

/** Every part a What changed message can have, except the one-off page rewrite. */
const everything: UpdateContent = {
  topics: [
    {
      name: "T7 run",
      id: "a1b2c3d4e5",
      events: [{ at, kind: "message", questId: "q-1", sessionId: "leader", messageIndex: 3, text: "Keep 0.02" }],
    },
  ],
  unsorted: [{ questId: "q-2", title: "Composer height" }],
  settledThreads: [{ key: "t-3", name: "Sidebar is slow", firstMessage: "Sidebar is slow" }],
  newThreads: [{ key: "t-5", name: "Sidebar is slow", firstMessage: "The sidebar is slow" }],
  joinChecks: {
    threads: [
      {
        key: "t-4",
        name: "Composer height",
        firstMessage: "The composer is a little high",
        openedFrom: "q-2938",
        wentTo: ["q-2896"],
      },
    ],
    earlier: [{ key: "t-1", name: "Collapsed composer sits low" }],
  },
  homeLines: ["q-1"],
  instructions: "Group by product area",
  forced: ["T7 run"],
  elsewhere: [{ sessionNum: 9, at, index: 4, threadKey: "q-5", text: "Done with the plots" }],
  newTopics: [{ id: "f0e1d2c3b4", name: "Eval stalls", questIds: ["q-6"] }],
  consolidate: { count: 16, target: 15, quiet: [{ id: "0a1b2c3d4e", name: "Area 0", quests: 1, questsSince: 15 }] },
};

describe("Scribe messages", () => {
  it("carry what changed under short headings, leaving how to handle each part to the brief", () => {
    // Jiayi (Nov 1): messages sent on every new thread repeated the same instructions; those live
    // in the Scribe's brief, so a message holds the changes and points there. The commands to use
    // are named only in the brief.
    const text = updateMessage(leader, everything, () => 7)!;
    expect(text).not.toContain("takode ");
    expect(text).toContain("work through it as your brief describes");
    expect(text).toContain('Threads the user just started (name each):\n- t-5 "Sidebar is slow"');
    // A settled thread comes with where it was opened and where its requests went (Jiayi, Nov 1:
    // a thread joined onto the quest it was opened from, not the one its request went to).
    expect(text).toContain('- t-4 "Composer height"; opened while viewing q-2938; its requests went to q-2896');
    expect(text).toContain('  It began: "The composer is a little high"');
    // The candidates have their own heading, apart from the new thread's bullet.
    expect(text).toContain('\n\nEarlier threads they might continue:\n- t-1 "Collapsed composer sits low"');
    expect(text).toContain('- "Area 0" (0a1b2c3d): 15 since, 1 in it');
    expect(text).toContain("Home lines to write: q-1");
    // Each part's heading is one line, not a paragraph of instructions.
    for (const line of text.split("\n")) expect(line.length).toBeLessThan(160);
  });

  it("says nothing when nothing changed, and only names the work left in a reminder", () => {
    expect(updateMessage(leader, { topics: [], unsorted: [], forced: [] }, () => 7)).toBeNull();
    const reminder = reminderMessage(['"T7 run": 1 event not on its page yet']);
    expect(reminder).toContain('- "T7 run": 1 event not on its page yet');
    expect(reminder).not.toContain("takode ");
  });
});
