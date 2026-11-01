import { describe, expect, it } from "vitest";
import type { QuestmasterTask } from "./quest-types.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { firstLine, questHomeLine, threadHomeLines } from "./home-lines.js";

/**
 * Home's stand-in lines, until a leader's Scribe writes one: a quest's latest phase note summary (a
 * finished quest's debrief summary) and a thread's latest leader answer, as one plain short line.
 */
describe("home lines", () => {
  it("keeps the first line of prose, without list markers, emphasis or link targets", () => {
    expect(firstLine("\n- **Built** the [status row](file:x.ts:1) for `every` leader.\n- More")).toBe(
      "Built the status row for every leader.",
    );
    expect(firstLine("## Heading\n| a | b |\nPlain text")).toBe("Plain text");
    expect(firstLine("x".repeat(200))).toHaveLength(160);
  });

  it("takes a quest's latest phase note, or a finished quest's debrief", () => {
    const quest = {
      questId: "q-1",
      status: "in_progress",
      feedback: [
        { author: "agent", kind: "phase_summary", text: "Older", ts: 1 },
        { author: "human", kind: "comment", text: "A comment", ts: 2 },
        { author: "agent", kind: "phase_summary", text: "Body", tldr: "- Newest note\n- more", ts: 3 },
      ],
    } as unknown as QuestmasterTask;
    expect(questHomeLine(quest)).toEqual({ text: "Newest note", at: 3, source: "note" });
    const done = { ...quest, status: "done", debriefTldr: "- Landed the row", completedAt: 9 } as QuestmasterTask;
    expect(questHomeLine(done)).toEqual({ text: "Landed the row", at: 9, source: "debrief" });
    expect(questHomeLine({ questId: "q-2", status: "refined" } as QuestmasterTask)).toBeNull();
  });

  it("takes the leader's latest answer in each thread", () => {
    const answer = (threadKey: string, text: string, timestamp: number) =>
      ({
        type: "assistant",
        leaderThreadRole: "answer",
        threadKey,
        timestamp,
        message: { content: [{ type: "text", text }] },
      }) as unknown as BrowserIncomingMessage;
    const history = [
      answer("topic:aa11bb22", "First answer", 1),
      answer("topic:aa11bb22", "Latest answer", 2),
      { ...answer("topic:aa11bb22", "Commentary", 3), leaderThreadRole: "commentary" } as BrowserIncomingMessage,
      answer("q-5", "A quest's", 4),
    ];
    expect(threadHomeLines(history, ["topic:aa11bb22", "topic:cc33dd44"])).toEqual({
      "topic:aa11bb22": { text: "Latest answer", at: 2, source: "answer" },
    });
  });
});
