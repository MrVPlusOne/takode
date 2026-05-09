import { describe, it, expect } from "vitest";
import { applyQuestListFilters, getQuestListPage, getQuestListPageAsync } from "./quest-list-filters.js";
import type { QuestDone, QuestmasterTask } from "./quest-types.js";

function makeQuest(
  input: Partial<QuestmasterTask> & { questId: string; title: string; status: QuestmasterTask["status"] },
): QuestmasterTask {
  return {
    id: `${input.questId}-v1`,
    questId: input.questId,
    version: 1,
    title: input.title,
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt,
    statusChangedAt: input.statusChangedAt,
    status: input.status,
    description: input.description ?? "desc",
    tldr: input.tldr,
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

  it("filters non-ASCII text queries instead of treating them as empty", () => {
    const match = makeQuest({ questId: "q-27", title: "修复 记忆 搜索", status: "idea" });
    const miss = makeQuest({ questId: "q-28", title: "Fix memory search", status: "idea" });

    expect(applyQuestListFilters([match, miss], { text: "记忆" }).map((q) => q.questId)).toEqual(["q-27"]);
  });

  it("returns no text matches for punctuation-only queries", () => {
    const quest = makeQuest({ questId: "q-29", title: "Any quest", status: "idea" });

    expect(applyQuestListFilters([quest], { text: "!!!" })).toEqual([]);
  });

  it("matches word prefixes, CamelCase, and divided word tokens", () => {
    // Prefix matching should be token-aware across common code and title forms.
    const camel = makeQuest({ questId: "q-22", title: "Fix QuestmasterSearchPanel", status: "idea" });
    const divided = makeQuest({ questId: "q-23", title: "Tune memory-ui_setting flow", status: "idea" });

    expect(applyQuestListFilters([camel], { text: "quest search" }).map((q) => q.questId)).toEqual(["q-22"]);
    expect(applyQuestListFilters([divided], { text: "memory ui sett" }).map((q) => q.questId)).toEqual(["q-23"]);
  });

  it("ranks primary quest fields ahead of body-only matches", () => {
    // The BM25 quest document indexes quest ID/title/tags twice and body text
    // once, so primary-field matches remain stronger than body-only matches.
    const tagMatch = makeQuest({ questId: "q-24", title: "Memory controls", status: "done", tags: ["ui"] });
    const bodyMatch = makeQuest({ questId: "q-25", title: "Memory controls", status: "done" });
    bodyMatch.description = "Body copy documents ui behavior.";
    const prefixMatch = makeQuest({ questId: "q-26", title: "Memory uikit controls", status: "done" });

    const result = getQuestListPage([prefixMatch, bodyMatch, tagMatch], { text: "memory ui" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-24", "q-26", "q-25"]);
  });

  it("uses direct freshness to rank newer comparable title matches first", () => {
    // Comparable exact title matches should no longer fall back to shorter
    // titles or lower quest IDs before recency.
    const oldMatch = makeQuest({ questId: "q-36", title: "Audit logging", status: "idea", createdAt: 10 });
    const newMatch = makeQuest({ questId: "q-37", title: "Audit logging", status: "idea", createdAt: 30 });

    const result = getQuestListPage([oldMatch, newMatch], { text: "audit" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-37", "q-36"]);
  });

  it("keeps strong primary text matches ahead of weak recent body-only matches", () => {
    // Recency can move close text matches, but its boost is capped so a clear
    // title/tag match remains ahead of a weak body-only result.
    const strongTitle = makeQuest({
      questId: "q-38",
      title: "Audit replay workflow",
      status: "idea",
      createdAt: 10,
    });
    const weakRecentBody = makeQuest({
      questId: "q-39",
      title: "Recent notes",
      status: "idea",
      createdAt: 1_000,
      description: "Body-only audit replay mention.",
    });

    const result = getQuestListPage([weakRecentBody, strongTitle], { text: "audit replay" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-38", "q-39"]);
  });

  it("does not let long feedback repetition dominate concise primary matches", () => {
    // BM25 term-frequency saturation should prevent repeated body terms from
    // swamping a concise title that matches all query terms.
    const titleMatch = makeQuest({
      questId: "q-40",
      title: "Audit controls",
      status: "done",
      createdAt: 10,
    });
    const bodySpam = makeQuest({
      questId: "q-41",
      title: "Feedback archive",
      status: "done",
      createdAt: 1_000,
    });
    bodySpam.feedback = [{ author: "agent", ts: 1, text: `${"audit ".repeat(300)}controls`, addressed: false }];

    const result = getQuestListPage([bodySpam, titleMatch], { text: "audit controls" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-40", "q-41"]);
  });

  it("requires every query token to match", () => {
    const partial = makeQuest({ questId: "q-42", title: "Audit logging", status: "idea" });
    const full = makeQuest({ questId: "q-43", title: "Audit logging replay", status: "idea" });

    const result = getQuestListPage([partial, full], { text: "audit replay" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-43"]);
  });

  it("uses created, updated, and status-changed timestamps for freshness", () => {
    // Recency falls back through the approved quest activity fields.
    const createdOnly = makeQuest({
      questId: "q-44",
      title: "Audit freshness",
      status: "idea",
      createdAt: 100,
    });
    const updated = makeQuest({
      questId: "q-45",
      title: "Audit freshness",
      status: "idea",
      createdAt: 10,
      updatedAt: 300,
    });
    const statusChanged = makeQuest({
      questId: "q-46",
      title: "Audit freshness",
      status: "idea",
      createdAt: 10,
      statusChangedAt: 500,
    });

    const result = getQuestListPage([createdOnly, updated, statusChanged], { text: "audit" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-46", "q-45", "q-44"]);
  });

  it("keeps empty-query updated sorting unchanged", () => {
    // Empty Universal Search Quest mode requests updated-desc sorting instead
    // of text ranking; that path should continue to use quest activity recency.
    const oldQuest = makeQuest({ questId: "q-47", title: "Old quest", status: "idea", createdAt: 100 });
    const updatedQuest = makeQuest({
      questId: "q-48",
      title: "Updated quest",
      status: "idea",
      createdAt: 10,
      updatedAt: 300,
    });

    const result = getQuestListPage([oldQuest, updatedQuest], {
      sortColumn: "updated",
      sortDirection: "desc",
    });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-48", "q-47"]);
  });

  it("keeps search-filtered counts before applying the status filter", () => {
    // Questmaster status tabs display counts for the current search corpus,
    // even when one status tab is selected.
    const doneMatch = makeQuest({ questId: "q-30", title: "Shared search result", status: "done" });
    const ideaMatch = makeQuest({ questId: "q-31", title: "Shared search draft", status: "idea" });
    const miss = makeQuest({ questId: "q-32", title: "Unrelated task", status: "refined" });

    const result = getQuestListPage([doneMatch, ideaMatch, miss], { text: "shared", status: "done" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-30"]);
    expect(result.counts).toMatchObject({ all: 2, done: 1, idea: 1, refined: 0, in_progress: 0 });
  });

  it("keeps the async page path semantically equivalent to the sync page path", async () => {
    // The HTTP route uses the async path so long text searches can yield
    // between chunks without changing result ordering or counts.
    const tagMatch = makeQuest({ questId: "q-33", title: "Memory controls", status: "done", tags: ["ui"] });
    const bodyMatch = makeQuest({ questId: "q-34", title: "Memory controls", status: "done" });
    bodyMatch.description = "Body copy documents ui behavior.";
    const prefixMatch = makeQuest({ questId: "q-35", title: "Memory uikit controls", status: "done" });

    const options = { text: "memory ui", status: "done", limit: 2 };
    const sync = getQuestListPage([prefixMatch, bodyMatch, tagMatch], options);
    const asyncPage = await getQuestListPageAsync([prefixMatch, bodyMatch, tagMatch], options);

    expect(sync.quests.map((quest) => quest.questId)).toEqual(["q-33", "q-35"]);
    expect(asyncPage).toEqual(sync);
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
