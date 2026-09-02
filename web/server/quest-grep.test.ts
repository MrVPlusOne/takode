import { describe, expect, it } from "vitest";
import { grepQuests } from "./quest-grep.js";
import type { QuestmasterTask } from "./quest-types.js";

describe("grepQuests", () => {
  it("searches title, description, and feedback with explicit match locations", () => {
    const quests: QuestmasterTask[] = [
      {
        id: "q-1-v1",
        questId: "q-1",
        version: 1,
        title: "Beta title match",
        createdAt: 1,
        status: "refined",
        description: "Alpha project summary",
      },
      {
        id: "q-2-v2",
        questId: "q-2",
        version: 2,
        title: "Quest with long description",
        createdAt: 2,
        status: "in_progress",
        description:
          "This description includes the beta keyword in the middle so the snippet builder has to include context.",
        sessionId: "session-2",
        claimedAt: 2,
      },
      {
        id: "q-3-v3",
        questId: "q-3",
        version: 3,
        title: "Feedback quest",
        createdAt: 3,
        status: "done",
        description: "Needs review",
        sessionId: "session-3",
        claimedAt: 3,
        completedAt: 4,
        verificationItems: [{ text: "Visual pass", checked: false }],
        verificationInboxUnread: true,
        feedback: [
          { author: "human", text: "Please verify the beta warning copy inside the modal.", ts: 3 },
          { author: "agent", text: "Summary: updated wording", ts: 4 },
        ],
      },
    ];

    const result = grepQuests(quests, "beta");

    expect(result.totalMatches).toBe(3);
    expect(result.matches.map((match) => match.matchedField)).toEqual(["title", "description", "feedback[0]"]);
    expect(result.matches[0]).toMatchObject({ questId: "q-1", matchedField: "title" });
    expect(result.matches[1].snippet.toLowerCase()).toContain("beta");
    expect(result.matches[2]).toMatchObject({
      questId: "q-3",
      matchedField: "feedback[0]",
      feedbackIndex: 0,
      feedbackAuthor: "human",
    });
    expect(result.matches[2]).not.toHaveProperty("feedbackTs");
  });

  it("ignores deleted feedback while preserving later raw feedback indices", () => {
    const quest: QuestmasterTask = {
      id: "q-8-v1",
      questId: "q-8",
      version: 1,
      title: "Stable feedback grep",
      createdAt: 1,
      status: "refined",
      description: "No matching body text.",
      feedback: [
        { author: "agent", text: "First live note", ts: 1 },
        { author: "human", text: "deleted-beta-secret", ts: 2, deletedAt: 3 },
        { author: "human", text: "Live beta review", ts: 4 },
      ],
    };

    const result = grepQuests([quest], "beta");

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      matchedField: "feedback[2]",
      feedbackIndex: 2,
      feedbackAuthor: "human",
      snippet: "Live beta review",
    });
  });

  it("fails fast when the regex pattern is invalid", () => {
    const quests: QuestmasterTask[] = [
      {
        id: "q-9-v1",
        questId: "q-9",
        version: 1,
        title: "Literal bracket search",
        createdAt: 9,
        status: "refined",
        description: "Search for foo[bar in literal mode.",
      },
    ];

    expect(() => grepQuests(quests, "foo[bar")).toThrow('Invalid regex pattern "foo[bar"');
  });

  it("caps returned matches while preserving the full match count", () => {
    const quests: QuestmasterTask[] = [
      {
        id: "q-1-v1",
        questId: "q-1",
        version: 1,
        title: "Alpha one",
        createdAt: 1,
        status: "refined",
        description: "alpha desc",
      },
      {
        id: "q-2-v1",
        questId: "q-2",
        version: 1,
        title: "Alpha two",
        createdAt: 2,
        status: "refined",
        description: "alpha again",
      },
    ];

    const result = grepQuests(quests, "alpha", { limit: 2 });

    // Limiting the response must not hide the fact that more total matches exist.
    expect(result.totalMatches).toBe(4);
    expect(result.matches).toHaveLength(2);
  });

  it("prefers TLDR snippets when TLDR metadata matches", () => {
    const quests: QuestmasterTask[] = [
      {
        id: "q-1-v1",
        questId: "q-1",
        version: 1,
        title: "Long content",
        createdAt: 1,
        status: "refined",
        description: "The full description also mentions alpha but should not be the preview source.",
        tldr: "Alpha summary for humans.",
        feedback: [
          {
            author: "agent",
            kind: "phase_summary",
            text: "The detailed feedback also mentions beta in a much longer agent-dense note.",
            tldr: "Beta feedback summary.",
            ts: 1,
            journeyRunId: "run-1",
            phaseOccurrenceId: "run-1:p2",
            phaseId: "implement",
            phasePosition: 2,
            phaseOccurrence: 1,
          },
        ],
      },
    ];

    const result = grepQuests(quests, "alpha|beta");

    expect(result.matches.map((match) => match.matchedField)).toEqual(["description.tldr", "feedback[0].tldr"]);
    expect(result.matches[0].snippet).toBe("Alpha summary for humans.");
    expect(result.matches[1].snippet).toBe("Beta feedback summary.");
    expect(result.matches[1]).toMatchObject({
      feedbackKind: "phase_summary",
      journeyRunId: "run-1",
      phaseOccurrenceId: "run-1:p2",
      phaseId: "implement",
      phasePosition: 2,
      phaseOccurrence: 1,
    });
  });

  it("does not grep an unsealed completed Outcome as a delivered result", () => {
    const quest: QuestmasterTask = {
      id: "q-10-v2",
      questId: "q-10",
      version: 2,
      title: "Completed Outcome grep guard",
      createdAt: 1,
      status: "done",
      description: "Initial request.",
      completedAt: 2,
      verificationItems: [],
      debrief: "Trusted final debrief.",
      debriefTldr: "Trusted final summary.",
      outcome: {
        currentRevisionId: "r2",
        finalizedRevisionId: "r1",
        revisions: [
          {
            revisionId: "r2",
            markdown: "Unsealed-only-needle draft detail.",
            summaryMarkdown: "Unsealed-only-needle draft summary.",
            summarySource: "derived",
            contentHash: "hash-r2",
            createdAt: 2,
            actor: { kind: "human" },
            sources: [],
          },
        ],
      },
    };

    // Grep must agree with list/hover fallback instead of labeling a stale draft as Outcome.
    expect(grepQuests([quest], "unsealed-only-needle")).toMatchObject({ totalMatches: 0, matches: [] });
    const sealed = {
      ...quest,
      outcome: { ...quest.outcome!, finalizedRevisionId: "r2" },
    } as QuestmasterTask;
    expect(grepQuests([sealed], "unsealed-only-needle").matches).toEqual([
      expect.objectContaining({ questId: "q-10", matchedField: "outcome.tldr" }),
    ]);
  });

  it("searches final debrief text and prefers debrief TLDR snippets", () => {
    const quests: QuestmasterTask[] = [
      {
        id: "q-8-v2",
        questId: "q-8",
        version: 2,
        title: "Completed quest",
        createdAt: 1,
        status: "done",
        description: "Initial request.",
        completedAt: 2,
        verificationItems: [{ text: "Verify", checked: true }],
        debrief: "Final debrief contains deployment details in full.",
        debriefTldr: "Deployment details summary.",
      },
    ];

    const result = grepQuests(quests, "deployment");

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0]).toMatchObject({
      questId: "q-8",
      matchedField: "debrief.tldr",
      snippet: "Deployment details summary.",
    });
  });
});
