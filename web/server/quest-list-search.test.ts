import { afterEach, describe, expect, it, vi } from "vitest";
import { applyQuestListFilters, createQuestListSearch, getQuestListPage } from "./quest-list-filters.js";
import type { QuestListPageOptions } from "./quest-list-filters.js";
import type { QuestmasterTask } from "./quest-types.js";
import { withQuestRelationshipSummaries } from "./quest-relationships.js";
import * as searchUtils from "../shared/search-utils.js";

function quest(number: number, overrides: Partial<QuestmasterTask> = {}): QuestmasterTask {
  return {
    id: `q-${number}`,
    questId: `q-${number}`,
    version: 1,
    status: "done",
    title: "Search example",
    description: `Searchable body ${number}`,
    createdAt: number,
    updatedAt: number,
    completedAt: number,
    verificationItems: [],
    ...overrides,
  } as QuestmasterTask;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createQuestListSearch", () => {
  it("shares document preparation across concurrent queries and fresh record objects", async () => {
    // More than one yield chunk exercises overlap. Reparsed record identities must
    // not cause the same bodies to be tokenized once per request or query string.
    const records = Array.from({ length: 60 }, (_, index) => quest(index + 1));
    const options = { text: "searchable", limit: 20 };
    const expected = getQuestListPage(records, options);
    const tokenize = vi.spyOn(searchUtils, "tokenizeSearchText");
    const search = createQuestListSearch(async () => structuredClone(records));
    const pages = await Promise.all([search.page(options), search.page(options)]);
    expect(pages).toEqual([expected, expected]);
    await search.page({ text: "body", limit: 10 });
    expect(tokenize.mock.calls.filter(([text]) => text.startsWith("Searchable body "))).toHaveLength(60);
  });

  it.each([
    ["title", { title: "uniqueneedle" }],
    ["description", { description: "uniqueneedle" }],
    ["tags", { tags: ["uniqueneedle"] }],
    ["TLDR", { tldr: "uniqueneedle" }],
    ["debrief", { debrief: "uniqueneedle" }],
    ["debrief TLDR", { debriefTldr: "uniqueneedle" }],
    ["feedback text", { feedback: [{ author: "agent", text: "uniqueneedle", ts: 1 }] }],
    ["feedback TLDR", { feedback: [{ author: "agent", text: "detail", tldr: "uniqueneedle", ts: 1 }] }],
    ["quiz", { quizItems: [{ id: "quiz", question: "Question", answer: "uniqueneedle" }] }],
    ["owner", { sessionId: "uniqueneedle", ownerKind: "codex" }],
    ["previous owner", { previousOwners: [{ kind: "takode", sessionId: "uniqueneedle" }] }],
  ] satisfies Array<
    [string, Partial<QuestmasterTask>]
  >)("refreshes changed %s without relying on version or timestamp", async (_field, patch) => {
    // Mutable records can keep their version, and derived text can change
    // without their own timestamp changing. Inspect the actual searchable fields.
    let records = [quest(1)];
    const search = createQuestListSearch(async () => structuredClone(records));
    expect((await search.page({ text: "uniqueneedle" })).total).toBe(0);
    records = [{ ...records[0]!, ...patch } as QuestmasterTask];
    expect(await search.page({ text: "uniqueneedle" })).toEqual(getQuestListPage(records, { text: "uniqueneedle" }));
    expect((await search.page({ text: "uniqueneedle" })).total).toBe(1);
  });

  it("updates incoming relationships when only a different quest changes", async () => {
    // A reference added to one quest changes the target's search document even
    // though the target's version and timestamps are unchanged.
    let records = [quest(1), quest(2)];
    const search = createQuestListSearch(async () => withQuestRelationshipSummaries(structuredClone(records)));
    expect((await search.page({ text: "referenced by" })).total).toBe(0);
    records[0] = { ...records[0]!, description: "See q-2" };
    expect((await search.page({ text: "referenced by" })).quests.map((item) => item.questId)).toEqual(["q-2"]);
    records = [records[1]!];
    expect((await search.page({ text: "referenced by" })).total).toBe(0);
  });

  it("removes tombstoned feedback and ineligible debriefs from warm searches", async () => {
    // Cached tokens must not keep deleted or status-ineligible content searchable.
    let records = [
      quest(1, { debrief: "debriefneedle", feedback: [{ author: "human", text: "feedbackneedle", ts: 1 }] }),
    ];
    const search = createQuestListSearch(async () => structuredClone(records));
    expect((await search.page({ text: "feedbackneedle debriefneedle" })).total).toBe(1);
    records[0] = quest(1, {
      cancelled: true,
      debrief: "debriefneedle",
      feedback: [{ author: "human", text: "feedbackneedle", ts: 1, deletedAt: 2 }],
    });
    expect((await search.page({ text: "feedbackneedle" })).total).toBe(0);
    expect((await search.page({ text: "debriefneedle" })).total).toBe(0);
  });

  it("refreshes recency without rebuilding unchanged token frequencies", async () => {
    // Activity metadata affects ranking independently of searchable text. Shared
    // documents must not freeze freshness or mutate older request snapshots.
    let records = [quest(1, { description: "samebody" }), quest(2, { description: "samebody" })];
    const tokenize = vi.spyOn(searchUtils, "tokenizeSearchText");
    const search = createQuestListSearch(async () => structuredClone(records));
    expect((await search.page({ text: "same" })).quests[0]?.questId).toBe("q-2");
    records[0] = { ...records[0]!, updatedAt: 3 };
    expect((await search.page({ text: "same" })).quests[0]?.questId).toBe("q-1");
    expect(tokenize.mock.calls.filter(([text]) => text === "samebody")).toHaveLength(2);
  });

  it("preserves filtered corpus statistics, counts, ordering and pagination", async () => {
    // Shared documents must not make BM25 statistics or status counts depend on
    // the preceding query/filter or on the visible page size.
    const records = [quest(1, { tags: ["ui"] }), quest(2, { status: "idea" }), quest(3, { tags: ["ui"] })];
    const search = createQuestListSearch(async () => structuredClone(records));
    const options: QuestListPageOptions[] = [
      { text: "search", limit: 1 },
      { text: "search", status: "done", limit: 1, offset: 1 },
      { text: "search", tags: "ui" },
      { text: "body", excludeTags: "ui" },
      { text: "absent" },
      { text: "!!!" },
      { sortColumn: "updated", sortDirection: "desc" },
    ];
    for (const option of options) expect(await search.page(option)).toEqual(getQuestListPage(records, option));
  });

  it("does not resurrect deleted cache entries from an older pending corpus read", async () => {
    // A request started before deletion may finish with its own old snapshot,
    // but it must not retain a removed document after a newer corpus was seen.
    let releaseOld!: (records: QuestmasterTask[]) => void;
    const records = [quest(1)];
    const read = vi
      .fn<() => Promise<QuestmasterTask[]>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOld = resolve;
          }),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValue(records);
    const tokenize = vi.spyOn(searchUtils, "tokenizeSearchText");
    const search = createQuestListSearch(read);
    const oldRequest = search.page({ text: "searchable" });
    expect((await search.page({ text: "searchable" })).total).toBe(0);
    releaseOld(records);
    expect((await oldRequest).total).toBe(1);
    expect((await search.page({ text: "searchable" })).total).toBe(1);
    expect(tokenize.mock.calls.filter(([text]) => text === "Searchable body 1")).toHaveLength(2);
  });

  it("does not serve a warm cache when the authoritative read fails", async () => {
    // Cached preparation cannot substitute for a missing current corpus.
    const read = vi.fn<() => Promise<QuestmasterTask[]>>().mockResolvedValue([quest(1)]);
    const search = createQuestListSearch(read);
    await search.page({ text: "searchable" });
    read.mockRejectedValueOnce(new Error("Store unavailable"));
    await expect(search.page({ text: "searchable" })).rejects.toThrow("Store unavailable");
    expect((await search.page({ text: "searchable" })).total).toBe(1);
  });

  it("filters full quests like applyQuestListFilters, reusing the documents a page search prepared", async () => {
    // The CLI's `quest list --text` once rebuilt every quest's document synchronously
    // on the event loop, freezing the server for a minute. Its filter must return the
    // same quests as the sync filter while sharing the page search's warm cache.
    const records = [
      quest(1, { tags: ["ui"] }),
      quest(2, { status: "idea", description: "other words" }),
      quest(3, { tags: ["ui"], description: "Searchable body 3 extra" }),
    ];
    const cases = [{ text: "searchable" }, { text: "searchable", status: "done", tags: "ui" }, { status: "idea" }];
    const expected = cases.map((filters) => applyQuestListFilters(records, filters));
    const tokenize = vi.spyOn(searchUtils, "tokenizeSearchText");
    const search = createQuestListSearch(async () => structuredClone(records));
    await search.page({ text: "searchable" });
    const prepared = tokenize.mock.calls.length;
    for (const [index, filters] of cases.entries()) expect(await search.filter(filters)).toEqual(expected[index]);
    // Only query strings were tokenized again; no quest body was re-prepared.
    expect(tokenize.mock.calls.slice(prepared).filter(([text]) => text.startsWith("Searchable body "))).toHaveLength(0);
    const controller = new AbortController();
    controller.abort();
    await expect(search.filter({ text: "searchable" }, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("stops an aborted request at the next yield without cancelling another reader", async () => {
    // Fake timers make the cancellation boundary deterministic, with no slow
    // stress workload or wall-clock race. The next request reuses completed work.
    vi.useFakeTimers();
    const records = Array.from({ length: 60 }, (_, index) => quest(index + 1));
    const tokenize = vi.spyOn(searchUtils, "tokenizeSearchText");
    const read = vi.fn(async () => structuredClone(records));
    const search = createQuestListSearch(read);
    const controller = new AbortController();
    const cancelled = search.page({ text: "searchable" }, controller.signal).catch((error: Error) => error);
    // Settle the corpus read; the search then stops at its first timer yield.
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    expect(tokenize.mock.calls.filter(([text]) => text.startsWith("Searchable body "))).toHaveLength(25);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await cancelled).toMatchObject({ name: "AbortError" });
    expect(tokenize.mock.calls.filter(([text]) => text.startsWith("Searchable body "))).toHaveLength(25);
    vi.useRealTimers();
    expect((await search.page({ text: "searchable" })).total).toBe(60);
    expect(tokenize.mock.calls.filter(([text]) => text.startsWith("Searchable body "))).toHaveLength(60);
    await expect(search.page({ text: "searchable" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
