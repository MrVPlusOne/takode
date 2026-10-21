import { describe, expect, it } from "vitest";
import type { ActivityThread } from "./activity-stream.js";
import {
  buildWorkspaceVocabulary,
  extractKeyTerms,
  recentActivityLines,
  workspaceEnhancerBlocks,
  workspaceReference,
  workspaceSttLines,
} from "./transcription-workspace-context.js";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 20, 20, 0, 0);

function thread(
  sessionId: string,
  messages: Array<[hoursAgo: number, role: "user" | "answer", text: string]>,
  threadKey?: string,
): ActivityThread {
  return {
    session: null,
    sessionId,
    sessionName: sessionId,
    space: "Work",
    ...(threadKey ? { thread: threadKey } : {}),
    messages: messages.map(([hoursAgo, role, text], index) => ({ role, index, at: NOW - hoursAgo * HOUR, text })),
  };
}

describe("extractKeyTerms", () => {
  it("picks names, acronyms, words with digits and joined names, ranked by weighted count", () => {
    // Validates the word rules on dictation-shaped text: names in mid-sentence, digit words,
    // joined dataset names and acronyms qualify; plain English words never do.
    const terms = extractKeyTerms(
      [
        { text: "Ask Wenxu about the seeded-QA mix for the 12B run on Condor.", weight: 2 },
        { text: "The 12B run uses seeded-QA and vsc3p_telemetry; PRF is done.", weight: 1 },
        { text: "Wenxu said PRF finished on Condor.", weight: 1 },
      ],
      100,
    );
    expect(terms).toEqual(expect.arrayContaining(["Wenxu", "seeded-QA", "12B", "Condor", "PRF"]));
    expect(terms.slice(0, 3)).toEqual(expect.arrayContaining(["12B", "seeded-QA"]));
    expect(terms).not.toContain("Ask");
    expect(terms).not.toContain("run");
  });

  it("requires a weight of 2, so a word seen once in an agent answer is not a term", () => {
    expect(extractKeyTerms([{ text: "Then Zhaolin replied.", weight: 1 }], 100)).toEqual([]);
    expect(extractKeyTerms([{ text: "Then Zhaolin replied.", weight: 2 }], 100)).toEqual(["Zhaolin"]);
  });

  it("skips capitalized words that are usually written in lowercase", () => {
    // "Restart" is a UI label capitalized at the start of lines; the text also uses "restart".
    const terms = extractKeyTerms(
      [
        { text: "Press Restart Server, then restart the run. We restart often; restart is fine.", weight: 2 },
        { text: "Then Junhong checked it.", weight: 2 },
      ],
      100,
    );
    expect(terms).toContain("Junhong");
    expect(terms).not.toContain("Restart");
  });

  it("ignores URLs, Takode links and IDs, hashes, dates, file names, and overlong tokens", () => {
    const terms = extractKeyTerms(
      [
        {
          text: "See [q-12](quest:q-12) and https://Example.com/Path, commit 5f9632f4262983e8 on 2026-10-20 in Composer.test.tsx with an_extremely_long_identifier_name_that_goes_on.",
          weight: 3,
        },
      ],
      100,
    );
    expect(terms).toEqual([]);
  });

  it("drops everyday spoken words, however they are capitalized", () => {
    // "Yes" and "Main" pass the capitalization rules (mid-sentence capitals, UI labels) but any
    // recognizer knows them; names and jargon used the same way stay.
    const terms = extractKeyTerms(
      [
        { text: "Then Yes was the answer. Open the Main tab, then ask Wenxu. Why Condor?", weight: 2 },
        { text: "Again Yes and Main, and Wenxu on Condor.", weight: 2 },
      ],
      100,
    );
    expect(terms).toEqual(expect.arrayContaining(["Wenxu", "Condor"]));
    expect(terms).not.toEqual(expect.arrayContaining(["Yes"]));
    expect(terms).not.toContain("Main");
    expect(terms).not.toContain("Why");
  });

  it("drops terms that repeat other candidates or are ordinary phrases", () => {
    // Plurals of candidates or excluded words, adjective forms and joins of candidates repeat a term
    // already picked; capitalized ordinary hyphenated words and counted words are plain English.
    const text =
      "Use the GPU and GPUs with MSI and MSI-style LLM and LLM-based APIs, T7 and T6 and T7-vs-T6. One-time Read-aloud 3-hourly from 8,096-character text.";
    const terms = extractKeyTerms([{ text, weight: 2 }], 100);
    expect(terms).toEqual(expect.arrayContaining(["GPU", "MSI", "LLM", "T7", "T6"]));
    for (const noise of [
      "GPUs",
      "MSI-style",
      "LLM-based",
      "APIs",
      "T7-vs-T6",
      "One-time",
      "Read-aloud",
      "3-hourly",
      "096-character",
    ])
      expect(terms).not.toContain(noise);
  });

  it("keeps joined names whose parts are not all candidates", () => {
    const terms = extractKeyTerms([{ text: "The QA set and seeded-QA, SWE and SWE-bench.", weight: 2 }], 100);
    expect(terms).toEqual(expect.arrayContaining(["seeded-QA", "SWE-bench"]));
  });

  it("returns at most `limit` terms", () => {
    const text = Array.from({ length: 30 }, (_, i) => `T${i}`).join(" ");
    expect(extractKeyTerms([{ text, weight: 2 }], 10)).toHaveLength(10);
  });
});

describe("buildWorkspaceVocabulary", () => {
  it("keeps recent uncancelled quests and picks terms from the quests and the whole activity window", () => {
    const vocabulary = buildWorkspaceVocabulary({
      now: NOW,
      quests: [
        { title: "Old quest", createdAt: NOW - 30 * 24 * HOUR },
        { title: "Analyze seeded-QA signals", tldr: "How T7 uses seeded-QA", createdAt: NOW - 2 * HOUR },
        { title: "Cancelled quest", cancelled: true, createdAt: NOW - HOUR },
        // Created long ago but completed yesterday: recent by its status change.
        { title: "Audit Maidas rows", createdAt: NOW - 20 * 24 * HOUR, statusChangedAt: NOW - 24 * HOUR },
      ],
      activity: [
        thread("a", [[48, "user", "Two days ago Condor was down and Condor came back."]]),
        thread("b", [[2, "user", "I asked Wenxu about the run."]], "q-7"),
      ],
    });
    expect(vocabulary.questTitles).toEqual(["Analyze seeded-QA signals", "Audit Maidas rows"]);
    expect(vocabulary.terms).toEqual(expect.arrayContaining(["seeded-QA", "Condor", "Wenxu", "Maidas"]));
  });
});

describe("recentActivityLines", () => {
  it("lists messages newest first and drops the dictated thread's own lines", () => {
    const activity = [
      thread("a", [[3, "user", "In main."]]),
      thread("a", [[1, "user", "In the quest thread."]], "q-7"),
      thread("b", [[2, "answer", "See [the plan](file:docs/plan.md) at https://example.com."]]),
    ];
    expect(recentActivityLines(activity)).toEqual([
      "[user] In the quest thread.",
      "[agent] See [the plan] at",
      "[user] In main.",
    ]);
    expect(recentActivityLines(activity, { sessionId: "a", threadKey: "main" })).toEqual([
      "[user] In the quest thread.",
      "[agent] See [the plan] at",
    ]);
  });
});

describe("workspace renderers", () => {
  const context = {
    questTitles: ["Analyze seeded-QA signals", "Audit Maidas rows"],
    activity: Array.from({ length: 50 }, (_, i) => `[user] ${"x".repeat(200)} ${i}`),
    terms: ["seeded-QA", "Maidas"],
  };

  it("keeps the enhancer activity within its budget and lists the quest titles", () => {
    const [quests, activity] = workspaceEnhancerBlocks(context);
    expect(quests).toBe(
      "<RECENT_QUESTS>\nRecent quests: Analyze seeded-QA signals; Audit Maidas rows\n</RECENT_QUESTS>",
    );
    expect(activity!.length).toBeLessThanOrEqual(3200);
    expect(activity).toContain("[user] ");
  });

  it("gives speech-to-text the quest line and bounded activity lines", () => {
    const { questLine, activityLines } = workspaceSttLines(context);
    expect(questLine).toBe("Recent quests: Analyze seeded-QA signals; Audit Maidas rows");
    expect(activityLines.join("\n").length).toBeLessThanOrEqual(3000);
  });

  it("puts terms, quests and activity in the comment reference, and nothing for an empty workspace", () => {
    expect(workspaceReference(context)).toEqual(
      expect.objectContaining({
        key_terms: "seeded-QA, Maidas",
        recent_quests: "Recent quests: Analyze seeded-QA signals; Audit Maidas rows",
      }),
    );
    expect(workspaceReference({ questTitles: [], activity: [], terms: [] })).toBeUndefined();
    expect(workspaceEnhancerBlocks(undefined)).toEqual([]);
  });
});
