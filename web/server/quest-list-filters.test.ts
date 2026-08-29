import { describe, it, expect } from "vitest";
import {
  applyQuestListFilters,
  buildQuestListPreview,
  getQuestListPage,
  getQuestListPageAsync,
} from "./quest-list-filters.js";
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

  it("supports provider-qualified owner filters without changing legacy raw-ID matching", () => {
    // A direct Codex task and a Takode session can expose the same raw ID. Raw
    // filters remain backwards-compatible, while a provider prefix disambiguates them.
    const takode = makeQuest({
      questId: "q-8",
      title: "Takode owner",
      status: "in_progress",
      sessionId: "shared-owner",
    });
    const codex = {
      ...makeQuest({
        questId: "q-9",
        title: "Codex owner",
        status: "in_progress",
        sessionId: "shared-owner",
      }),
      ownerKind: "codex",
    } as QuestmasterTask;

    expect(applyQuestListFilters([takode, codex], { session: "shared-owner" })).toHaveLength(2);
    expect(
      applyQuestListFilters([takode, codex], { session: "takode:shared-owner" }).map((quest) => quest.questId),
    ).toEqual(["q-8"]);
    expect(
      applyQuestListFilters([takode, codex], { session: "codex:shared-owner" }).map((quest) => quest.questId),
    ).toEqual(["q-9"]);
  });

  it("searches and sorts provider-aware owners with identical raw IDs", () => {
    // Provider tokens and owner sort keys must not collapse Codex and Takode
    // identities just because their session IDs happen to match.
    const takode = makeQuest({
      questId: "q-10",
      title: "Owner record",
      status: "in_progress",
      sessionId: "same-id",
    });
    const codex = {
      ...makeQuest({
        questId: "q-11",
        title: "Owner record",
        status: "in_progress",
        sessionId: "same-id",
      }),
      ownerKind: "codex",
    } as QuestmasterTask;

    expect(applyQuestListFilters([takode, codex], { text: "codex same-id" }).map((quest) => quest.questId)).toEqual([
      "q-11",
    ]);
    expect(applyQuestListFilters([takode, codex], { text: "takode same-id" }).map((quest) => quest.questId)).toEqual([
      "q-10",
    ]);
    expect(
      getQuestListPage([takode, codex], { sortColumn: "owner", sortDirection: "asc" }).quests.map(
        (quest) => quest.questId,
      ),
    ).toEqual(["q-11", "q-10"]);
  });

  it("preserves provider-aware ownership in compact list previews", () => {
    // The bounded page must retain the small ownership fields required by the
    // UI without expanding to full feedback, history, or provenance payloads.
    const quest = {
      ...makeQuest({
        questId: "q-12",
        title: "Codex preview",
        status: "in_progress",
        sessionId: "codex-current",
      }),
      ownerKind: "codex",
      previousOwnerSessionIds: ["takode-old"],
      previousOwners: [
        { kind: "takode", sessionId: "takode-old" },
        { kind: "codex", sessionId: "codex-old" },
      ],
    } as QuestmasterTask;

    expect(getQuestListPage([quest], {}).quests[0]).toMatchObject({
      ownerKind: "codex",
      sessionId: "codex-current",
      previousOwnerSessionIds: ["takode-old"],
      previousOwners: [
        { kind: "takode", sessionId: "takode-old" },
        { kind: "codex", sessionId: "codex-old" },
      ],
    });
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

  it("ranks exact primary quest fields ahead of body-only and prefix matches", () => {
    // The BM25 quest document indexes quest ID/title/tags twice and body text
    // once, while exact-token matches still outrank prefix-only matches.
    const tagMatch = makeQuest({ questId: "q-24", title: "Memory controls", status: "done", tags: ["ui"] });
    const bodyMatch = makeQuest({ questId: "q-25", title: "Memory controls", status: "done" });
    bodyMatch.description = "Body copy documents ui behavior.";
    const prefixMatch = makeQuest({ questId: "q-26", title: "Memory uikit controls", status: "done" });

    const result = getQuestListPage([prefixMatch, bodyMatch, tagMatch], { text: "memory ui" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-24", "q-25", "q-26"]);
  });

  it("ranks exact title token matches ahead of newer prefix title token matches", () => {
    // q-1247 exact-before-prefix semantics still apply before freshness can
    // reorder comparable BM25 matches.
    const exactTitle = makeQuest({ questId: "q-49", title: "Audit logging", status: "idea", createdAt: 10 });
    const newerPrefixTitle = makeQuest({
      questId: "q-50",
      title: "Auditor logging",
      status: "idea",
      createdAt: 1_000,
    });

    const result = getQuestListPage([newerPrefixTitle, exactTitle], { text: "audit" });

    expect(result.quests.map((q) => q.questId)).toEqual(["q-49", "q-50"]);
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

  it("keeps Cards recency independent from compact title sorting", () => {
    // The server owns both projections: Cards use activity recency while Compact can use its persisted title sort.
    const newerCard = makeQuest({
      questId: "q-60",
      title: "Zulu newer card",
      status: "refined",
      createdAt: 800,
      updatedAt: 900,
    });
    const olderCard = makeQuest({
      questId: "q-61",
      title: "Alpha older card",
      status: "refined",
      createdAt: 50,
      updatedAt: 100,
    });

    const quests = [olderCard, newerCard];
    const cards = getQuestListPage(quests, { sortColumn: "cards", sortDirection: "asc" });
    const compact = getQuestListPage(quests, { sortColumn: "title", sortDirection: "asc" });

    expect(cards.quests.map((q) => q.questId)).toEqual(["q-60", "q-61"]);
    expect(compact.quests.map((q) => q.questId)).toEqual(["q-61", "q-60"]);
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

    expect(sync.quests.map((quest) => quest.questId)).toEqual(["q-33", "q-34"]);
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

  it("excludes feedback tombstones from previews, search, and feedback sorting", () => {
    const quest = makeQuest({ questId: "q-66", title: "Stable feedback links", status: "done" });
    quest.feedback = [
      { author: "human", text: "deleted-secret-keyword", ts: 1, deletedAt: 2 },
      { author: "agent", text: "Live implementation note", ts: 3 },
      { author: "human", text: "Live review note", ts: 4, addressed: false },
    ];

    expect(buildQuestListPreview(quest).feedbackSummary).toEqual({
      humanTotal: 1,
      humanUnaddressed: 1,
      humanAddressed: 0,
    });
    expect(applyQuestListFilters([quest], { text: "deleted-secret-keyword" })).toEqual([]);
    expect(applyQuestListFilters([quest], { text: "implementation note" }).map((item) => item.questId)).toEqual([
      "q-66",
    ]);

    const onlyDeleted = makeQuest({ questId: "q-67", title: "Deleted review only", status: "done" });
    onlyDeleted.feedback = [{ author: "human", text: "", ts: 1, deletedAt: 2 }];
    expect(buildQuestListPreview(onlyDeleted).feedbackSummary).toBeUndefined();
    expect(
      getQuestListPage([quest, onlyDeleted], { sortColumn: "feedback", sortDirection: "desc" }).quests.map(
        (item) => item.questId,
      ),
    ).toEqual(["q-66", "q-67"]);
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
    // verification=all is useful for quickly narrowing to all review-pending done quests regardless of inbox bucket.
    const result = applyQuestListFilters(quests, { verification: "all" });
    expect(result.map((q) => q.questId)).toEqual(["q-4", "q-5"]);
  });

  it("keeps --status needs_verification as a deprecated review-filter alias", () => {
    // Compatibility callers should still find done quests that remain in the review workflow.
    const result = applyQuestListFilters(quests, { status: "needs_verification" });
    expect(result.map((q) => q.questId)).toEqual(["q-4", "q-5"]);
  });
});
