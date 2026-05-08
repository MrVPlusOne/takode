import { describe, it, expect } from "vitest";
import { applyQuestListFilters, getQuestListPage } from "./quest-list-filters.js";
import type { QuestDone, QuestmasterTask } from "./quest-types.js";

function makeQuest(
  input: Partial<QuestmasterTask> & { questId: string; title: string; status: QuestmasterTask["status"] },
): QuestmasterTask {
  return {
    id: `${input.questId}-v1`,
    questId: input.questId,
    version: 1,
    title: input.title,
    createdAt: 1,
    status: input.status,
    description: "desc",
    ...(input.tags ? { tags: input.tags } : {}),
    ...("verificationInboxUnread" in input
      ? {
          verificationInboxUnread: (input as { verificationInboxUnread?: boolean }).verificationInboxUnread,
          verificationItems: [{ text: "check", checked: false }],
        }
      : {}),
    ...(input.status === "done" ? { completedAt: 2, verificationItems: [{ text: "check", checked: false }] } : {}),
    ...("sessionId" in input ? { sessionId: (input as { sessionId?: string }).sessionId, claimedAt: 1 } : {}),
  } as QuestmasterTask;
}

describe("applyQuestListFilters", () => {
  const quests: QuestmasterTask[] = [
    makeQuest({
      questId: "q-1",
      title: "Fix chat lag",
      status: "in_progress",
      tags: ["ui", "bugfix"],
      sessionId: "s1",
    }),
    makeQuest({ questId: "q-2", title: "Improve quest CLI", status: "idea", tags: ["questmaster", "feature"] }),
    makeQuest({
      questId: "q-3",
      title: "Done performance cleanup",
      status: "done",
      tags: ["performance"],
      sessionId: "s2",
    }),
    makeQuest({
      questId: "q-4",
      title: "Submit worker fix",
      status: "done",
      verificationInboxUnread: true,
    }),
    makeQuest({
      questId: "q-5",
      title: "Investigate backlog",
      status: "done",
      verificationInboxUnread: false,
    }),
  ];

  it("filters by multiple statuses from comma-separated input", () => {
    // Supports common shell-friendly usage like --status "idea,in_progress".
    const result = applyQuestListFilters(quests, { status: "idea,in_progress" });
    expect(result.map((q) => q.questId)).toEqual(["q-1", "q-2"]);
  });

  it("filters by tags (case-insensitive, any tag match)", () => {
    // Tag filter should match if at least one requested tag is present.
    const result = applyQuestListFilters(quests, { tags: "PERFORMANCE,missing" });
    expect(result.map((q) => q.questId)).toEqual(["q-3"]);
  });

  it("filters by owning session ID", () => {
    // Session filter is useful for quickly narrowing to claimed work.
    const result = applyQuestListFilters(quests, { session: "s1" });
    expect(result.map((q) => q.questId)).toEqual(["q-1"]);
  });

  it("filters by free-text search in quest id, title, and description", () => {
    // Text search should be case-insensitive and include quest id/title/description.
    const result = applyQuestListFilters(quests, { text: "cli" });
    expect(result.map((q) => q.questId)).toEqual(["q-2"]);
  });

  it("does not count arbitrary mid-word substrings as text matches", () => {
    // The `memory ui` report showed bad matches where `ui` came from words
    // like `guidance` or `required`; those should no longer keep a quest.
    const bad = makeQuest({ questId: "q-20", title: "Fix memory defaults", status: "done", tags: ["memory"] });
    bad.description = "Remove remaining memory recall guidance and required renameable slugs.";
    const good = makeQuest({
      questId: "q-21",
      title: "Support memory settings",
      status: "done",
      tags: ["memory", "ui"],
    });

    expect(applyQuestListFilters([bad, good], { text: "memory ui" }).map((q) => q.questId)).toEqual(["q-21"]);
  });

  it("matches word prefixes, CamelCase, and divided word tokens", () => {
    // Prefix matching should be token-aware across common code and title forms.
    const camel = makeQuest({ questId: "q-22", title: "Fix QuestmasterSearchPanel", status: "idea" });
    const divided = makeQuest({ questId: "q-23", title: "Tune memory-ui_setting flow", status: "idea" });

    expect(applyQuestListFilters([camel], { text: "quest search" }).map((q) => q.questId)).toEqual(["q-22"]);
    expect(applyQuestListFilters([divided], { text: "memory ui sett" }).map((q) => q.questId)).toEqual(["q-23"]);
  });

  it("ranks exact word matches before prefixes and tag matches before body matches", () => {
    // Search ranking should keep q-1020 relevance ordering while tightening
    // match quality: exact words first, then field weighting, then prefixes.
    const tagMatch = makeQuest({ questId: "q-24", title: "Memory controls", status: "done", tags: ["ui"] });
    const bodyMatch = makeQuest({ questId: "q-25", title: "Memory controls", status: "done" });
    bodyMatch.description = "Body copy documents ui behavior.";
    const prefixMatch = makeQuest({ questId: "q-26", title: "Memory uikit controls", status: "done" });

    const result = getQuestListPage([prefixMatch, bodyMatch, tagMatch], { text: "memory ui" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-24", "q-25", "q-26"]);
  });

  it("filters by TLDR and still searches full feedback text when a feedback TLDR exists", () => {
    // TLDR improves scan previews, but it must not make detailed feedback undiscoverable.
    const quest = makeQuest({
      questId: "q-6",
      title: "Long feedback quest",
      status: "done",
      verificationInboxUnread: false,
    });
    quest.tldr = "Short quest scanline";
    quest.feedback = [{ author: "agent", text: "Full implementation detail", tldr: "Short handoff", ts: 1 }];

    expect(applyQuestListFilters([quest], { text: "scanline" }).map((q) => q.questId)).toEqual(["q-6"]);
    expect(applyQuestListFilters([quest], { text: "implementation" }).map((q) => q.questId)).toEqual(["q-6"]);
  });

  it("filters completed quests by final debrief text and debrief TLDR", () => {
    const quest = makeQuest({
      questId: "q-7",
      title: "Completed outcome quest",
      status: "done",
      verificationInboxUnread: false,
    }) as QuestDone;
    quest.debrief = "Final outcome confirms deployment health.";
    quest.debriefTldr = "Deployment healthy.";

    expect(applyQuestListFilters([quest], { text: "deployment healthy" }).map((q) => q.questId)).toEqual(["q-7"]);
    expect(applyQuestListFilters([quest], { text: "outcome confirms" }).map((q) => q.questId)).toEqual(["q-7"]);
  });

  it("matches quest ids from free-text search", () => {
    // Users often paste quest IDs directly (for example q-3), so text search
    // should match the questId field in addition to title/description.
    const result = applyQuestListFilters(quests, { text: "Q-3" });
    expect(result.map((q) => q.questId)).toEqual(["q-3"]);
  });

  it("combines multiple filters with AND semantics", () => {
    // Combined filters should allow precise narrowing without a custom DSL.
    const result = applyQuestListFilters(quests, {
      status: "done,in_progress",
      tags: "performance,bugfix",
      session: "s2",
    });
    expect(result.map((q) => q.questId)).toEqual(["q-3"]);
  });

  it("filters verification inbox quests", () => {
    // verification=inbox should include only done quests that are unread in the review inbox.
    const result = applyQuestListFilters(quests, { verification: "inbox" });
    expect(result.map((q) => q.questId)).toEqual(["q-4"]);
  });

  it("filters acknowledged verification quests", () => {
    // verification=reviewed should include only done review quests that were acknowledged (not in inbox).
    const result = applyQuestListFilters(quests, { verification: "reviewed" });
    expect(result.map((q) => q.questId)).toEqual(["q-5"]);
  });

  it("supports verification=all as all review-pending done quests", () => {
    // verification=all is useful for quickly narrowing to all verification items regardless of inbox bucket.
    const result = applyQuestListFilters(quests, { verification: "all" });
    expect(result.map((q) => q.questId)).toEqual(["q-4", "q-5"]);
  });

  it("keeps --status needs_verification as a deprecated review-filter alias", () => {
    // Compatibility callers should still find done quests that remain in the review workflow.
    const result = applyQuestListFilters(quests, { status: "needs_verification" });
    expect(result.map((q) => q.questId)).toEqual(["q-4", "q-5"]);
  });
});
