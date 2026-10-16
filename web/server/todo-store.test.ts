import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TodoMutationProvenance } from "../shared/todo-types.js";
import { deriveTodoMarkdown } from "../shared/todo-markdown.js";
import { TODO_INBOX_CATEGORY_ID, TodoStore, TodoStoreError } from "./todo-store.js";

let dir: string;
let path: string;
let store: TodoStore;

function provenance(at: number, kind: TodoMutationProvenance["authorization"]["kind"] = "ui") {
  return {
    actor: { kind: "user" as const, label: "User" },
    authorization: { kind },
    at,
  } satisfies TodoMutationProvenance;
}

beforeEach(() => {
  // Every test uses a disposable path so migration, corruption, and archive
  // coverage can never touch the user's durable ~/.companion/todos store.
  dir = mkdtempSync(join(tmpdir(), "takode-todo-store-test-"));
  path = join(dir, "todo-list.json");
  store = new TodoStore(path);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TodoStore", () => {
  it("stores one raw Markdown body and derives title/details without rewriting source", async () => {
    const markdown = "\n  Reply to **Alice**  \nOriginal: [Slack thread](https://example.slack.com/archives/C1/p123)\n";
    const created = await store.createItem({ markdown }, provenance(10));

    expect(created.markdown).toBe(markdown);
    expect(deriveTodoMarkdown(created.markdown)).toEqual({
      titleMarkdown: "Reply to **Alice**",
      detailsMarkdown: "Original: [Slack thread](https://example.slack.com/archives/C1/p123)\n",
    });

    const edited = await store.editItem(created.id, { markdown: `${markdown}More context` }, provenance(20));
    expect(edited.markdown).toBe(`${markdown}More context`);
    expect((await store.findItemsByLink("https://example.slack.com/archives/C1/p123"))[0]?.id).toBe(created.id);
    expect((await store.listItems({ search: "archives/c1/p123" }))[0]?.id).toBe(created.id);
  });

  it("migrates legacy split Markdown losslessly and writes an immutable recovery copy", async () => {
    const legacy = {
      schemaVersion: 1,
      revision: 7,
      updatedAt: 700,
      nextItemId: 3,
      nextCategoryId: 1,
      nextProposalId: 3,
      nextGrantId: 1,
      categories: [
        {
          id: "cat-inbox",
          name: "Inbox",
          createdAt: 1,
          updatedAt: 1,
          createdBy: provenance(1, "bootstrap"),
          lastModifiedBy: provenance(1, "bootstrap"),
        },
      ],
      items: [
        {
          id: "td-1",
          titleMarkdown: "  **Preserve me**  ",
          detailsMarkdown: "  detail line\nsecond line  ",
          categoryId: "cat-inbox",
          status: "todo",
          createdAt: 10,
          updatedAt: 20,
          statusChangedAt: 10,
          createdBy: provenance(10),
          lastModifiedBy: provenance(20),
        },
        {
          id: "td-2",
          titleMarkdown: "   ",
          detailsMarkdown: "Derived title\nremaining detail",
          categoryId: "cat-inbox",
          status: "doing",
          createdAt: 30,
          updatedAt: 40,
          statusChangedAt: 40,
          createdBy: provenance(30),
          lastModifiedBy: provenance(40),
        },
      ],
      proposals: [
        {
          id: "tp-1",
          mutation: { action: "item:edit", itemId: "td-1", input: { detailsMarkdown: "replacement" } },
          status: "pending",
          createdAt: 50,
          updatedAt: 50,
          requestedBy: { kind: "session", sessionId: "worker" },
        },
        {
          id: "tp-2",
          mutation: { action: "item:edit", itemId: "td-2", input: {} },
          status: "pending",
          createdAt: 51,
          updatedAt: 51,
          requestedBy: { kind: "session", sessionId: "legacy-worker" },
        },
      ],
      grants: [],
    };
    const raw = JSON.stringify(legacy, null, 2);
    writeFileSync(path, raw, "utf-8");

    const migrated = await new TodoStore(path).snapshot();
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.items[0]?.markdown).toBe("  **Preserve me**  \n  detail line\nsecond line  ");
    expect(migrated.items[1]?.markdown).toBe("   \nDerived title\nremaining detail");
    expect(migrated.items.map((item) => item.rank)).toEqual([2048, 1024]);
    // Retired proposals survive only in the recovery copy.
    expect(migrated).not.toHaveProperty("proposals");
    expect(readFileSync(`${path}.schema-v1.backup`, "utf-8")).toBe(raw);
    const persisted = JSON.parse(readFileSync(path, "utf-8"));
    expect(persisted.schemaVersion).toBe(3);
    expect(persisted.items[0].titleMarkdown).toBeUndefined();
    expect(persisted.items[0].detailsMarkdown).toBeUndefined();
  });

  it("migrates the maximum valid legacy title and details lengths without loss", async () => {
    const titleMarkdown = "T".repeat(500);
    const detailsMarkdown = "D".repeat(50_000);
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        updatedAt: 1,
        nextItemId: 2,
        nextCategoryId: 1,
        nextProposalId: 1,
        nextGrantId: 1,
        categories: [
          {
            id: "cat-inbox",
            name: "Inbox",
            createdAt: 1,
            updatedAt: 1,
            createdBy: provenance(1, "bootstrap"),
            lastModifiedBy: provenance(1, "bootstrap"),
          },
        ],
        items: [
          {
            id: "td-1",
            titleMarkdown,
            detailsMarkdown,
            categoryId: "cat-inbox",
            status: "todo",
            createdAt: 1,
            updatedAt: 1,
            statusChangedAt: 1,
            createdBy: provenance(1),
            lastModifiedBy: provenance(1),
          },
        ],
        proposals: [],
        grants: [],
      }),
      "utf-8",
    );

    const migrated = await new TodoStore(path).snapshot();
    expect(migrated.items[0]?.markdown).toBe(`${titleMarkdown}\n${detailsMarkdown}`);
    expect(migrated.items[0]?.markdown).toHaveLength(50_501);
  });

  it("refuses to migrate a legacy store missing its required Inbox category", async () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      updatedAt: 1,
      nextItemId: 1,
      nextCategoryId: 1,
      nextProposalId: 1,
      nextGrantId: 1,
      categories: [],
      items: [],
      proposals: [],
      grants: [],
    });
    writeFileSync(path, raw, "utf-8");

    await expect(new TodoStore(path).snapshot()).rejects.toMatchObject({ code: "corrupt_store" });
    expect(readFileSync(path, "utf-8")).toBe(raw);
    expect(() => readFileSync(`${path}.schema-v1.backup`, "utf-8")).toThrow();
  });

  it("refuses to rewrite legacy items with invalid category references", async () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      updatedAt: 1,
      nextItemId: 2,
      nextCategoryId: 1,
      nextProposalId: 1,
      nextGrantId: 1,
      categories: [
        {
          id: "cat-inbox",
          name: "Inbox",
          createdAt: 1,
          updatedAt: 1,
          createdBy: provenance(1, "bootstrap"),
          lastModifiedBy: provenance(1, "bootstrap"),
        },
      ],
      items: [
        {
          id: "td-1",
          titleMarkdown: "Orphaned item",
          categoryId: "cat-missing",
          status: "todo",
          createdAt: 1,
          updatedAt: 1,
          statusChangedAt: 1,
          createdBy: provenance(1),
          lastModifiedBy: provenance(1),
        },
      ],
      proposals: [],
      grants: [],
    });
    writeFileSync(path, raw, "utf-8");

    await expect(new TodoStore(path).snapshot()).rejects.toMatchObject({ code: "corrupt_store" });
    expect(readFileSync(path, "utf-8")).toBe(raw);
    expect(() => readFileSync(`${path}.schema-v1.backup`, "utf-8")).toThrow();
  });

  it("refuses migration when an existing recovery copy does not match the legacy source", async () => {
    const legacy = {
      schemaVersion: 1,
      revision: 0,
      updatedAt: 1,
      nextItemId: 1,
      nextCategoryId: 1,
      nextProposalId: 1,
      nextGrantId: 1,
      categories: [
        {
          id: "cat-inbox",
          name: "Inbox",
          createdAt: 1,
          updatedAt: 1,
          createdBy: provenance(1, "bootstrap"),
          lastModifiedBy: provenance(1, "bootstrap"),
        },
      ],
      items: [],
      proposals: [],
      grants: [],
    };
    writeFileSync(path, JSON.stringify(legacy), "utf-8");
    writeFileSync(`${path}.schema-v1.backup`, "different", "utf-8");

    await expect(new TodoStore(path).snapshot()).rejects.toMatchObject({ code: "corrupt_store" });
    expect(JSON.parse(readFileSync(path, "utf-8")).schemaVersion).toBe(1);
  });

  it("keeps exactly the current status timestamps and reversible archive state", async () => {
    const created = await store.createItem(
      { markdown: "[Reply](https://example.com/thread)", status: "todo" },
      provenance(100),
    );
    expect(created).toMatchObject({
      id: "td-1",
      categoryId: TODO_INBOX_CATEGORY_ID,
      status: "todo",
      createdAt: 100,
      updatedAt: 100,
      statusChangedAt: 100,
    });
    expect(created.completedAt).toBeUndefined();

    const done = await store.setItemStatus(created.id, "done", provenance(200));
    expect(done).toMatchObject({ status: "done", statusChangedAt: 200, completedAt: 200, updatedAt: 200 });

    const reopened = await store.setItemStatus(created.id, "doing", provenance(300));
    expect(reopened).toMatchObject({ status: "doing", statusChangedAt: 300, updatedAt: 300 });
    expect(reopened.completedAt).toBeUndefined();

    const archived = await store.setItemArchived(created.id, true, provenance(400));
    expect(archived.archivedAt).toBe(400);
    expect(await store.listItems()).toEqual([]);
    expect((await store.listItems({ includeArchived: true }))[0]?.id).toBe(created.id);

    const restored = await store.setItemArchived(created.id, false, provenance(500));
    expect(restored.archivedAt).toBeUndefined();
    expect((await store.listItems())[0]?.id).toBe(created.id);
  });

  it("records nothing for a change that leaves the item as it was", async () => {
    // Provenance shows the last change and who made it. A no-op (the same text, the status it
    // already has, restoring a to-do that is not archived) must not show up as an agent's change.
    const created = await store.createItem({ markdown: "Book flights\n\nAisle seat" }, provenance(100));
    const agent = provenance(200, "agent_direct");
    const before = await store.snapshot();

    await store.editItem(created.id, { markdown: "Book flights\n\nAisle seat" }, agent);
    await store.setItemStatus(created.id, "todo", agent);
    await store.setItemStatusWithCompletionUndo(created.id, "todo", agent);
    await store.setItemArchived(created.id, false, agent);
    await store.linkItemQuests(created.id, { removeQuestIds: ["q-7"] }, agent);
    await store.setItemDue(created.id, null, agent);

    expect(await store.snapshot()).toEqual(before);

    // A real change is still recorded.
    const edited = await store.editItem(created.id, { markdown: "Book flights\n\nAisle seat, Friday" }, agent);
    expect(edited).toMatchObject({ updatedAt: 200, lastModifiedBy: agent });
    expect((await store.snapshot()).revision).toBe(before.revision + 1);
  });

  it("atomically restores the exact active status, category, and ranks from a completion receipt", async () => {
    const first = await store.createItem({ markdown: "First" }, provenance(10));
    const second = await store.createItem({ markdown: "Second", status: "doing" }, provenance(20));
    const third = await store.createItem({ markdown: "Third" }, provenance(30));
    const before = await store.snapshot();
    const beforeRanks = before.items
      .filter((item) => item.categoryId === TODO_INBOX_CATEGORY_ID && item.status !== "done")
      .map(({ id, rank }) => ({ id, rank }));

    const completed = await store.setItemStatusWithCompletionUndo(second.id, "done", provenance(40));
    expect(completed.item).toMatchObject({ status: "done", completedAt: 40 });
    expect(completed.undo).toBeDefined();

    const restored = await store.undoItemCompletion(completed.undo!, provenance(50));
    expect(restored).toMatchObject({
      id: second.id,
      status: "doing",
      categoryId: TODO_INBOX_CATEGORY_ID,
      rank: before.items.find((item) => item.id === second.id)?.rank,
      statusChangedAt: 50,
      updatedAt: 50,
    });
    expect(restored.completedAt).toBeUndefined();
    expect(
      (await store.snapshot()).items
        .filter((item) => item.categoryId === TODO_INBOX_CATEGORY_ID && item.status !== "done")
        .sort((a, b) => a.rank - b.rank)
        .map(({ id, rank }) => ({ id, rank })),
    ).toEqual(beforeRanks);
    expect(beforeRanks.map(({ id }) => id)).toEqual([first.id, second.id, third.id]);
  });

  it("refuses a stale completion receipt after the active ordering changes", async () => {
    const first = await store.createItem({ markdown: "First" }, provenance(10));
    const second = await store.createItem({ markdown: "Second" }, provenance(20));
    const completed = await store.setItemStatusWithCompletionUndo(first.id, "done", provenance(30));
    await store.createItem({ markdown: "Inserted after completion", beforeItemId: second.id }, provenance(40));

    await expect(store.undoItemCompletion(completed.undo!, provenance(50))).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await store.getItem(first.id)).status).toBe("done");
  });

  it("inserts and reorders active items within and across categories using server-owned ranks", async () => {
    const slack = await store.createCategory({ name: "Slack" }, provenance(1));
    const first = await store.createItem({ markdown: "First" }, provenance(10));
    const third = await store.createItem({ markdown: "Third" }, provenance(30));
    const second = await store.createItem({ markdown: "Second", afterItemId: first.id }, provenance(20));
    expect((await store.listItems()).map((item) => item.id)).toEqual([first.id, second.id, third.id]);

    await store.moveItem(third.id, { beforeItemId: first.id }, provenance(40));
    expect((await store.listItems()).map((item) => item.id)).toEqual([third.id, first.id, second.id]);

    await store.moveItem(first.id, { categoryId: slack.id }, provenance(50));
    const snapshot = await store.snapshot();
    expect(snapshot.items.find((item) => item.id === first.id)).toMatchObject({ categoryId: slack.id, rank: 1024 });
    expect((await store.listItems({ categoryIds: [TODO_INBOX_CATEGORY_ID] })).map((item) => item.id)).toEqual([
      third.id,
      second.id,
    ]);
  });

  it("does not manually reorder Done items or rewrite completion time when moving categories", async () => {
    const results = await store.createCategory({ name: "Results" }, provenance(1));
    const first = await store.createItem({ markdown: "First done", status: "done" }, provenance(100));
    const second = await store.createItem({ markdown: "Second done", status: "done" }, provenance(200));

    await expect(store.moveItem(second.id, { beforeItemId: first.id }, provenance(300))).rejects.toMatchObject({
      code: "conflict",
    });
    const moved = await store.moveItem(first.id, { categoryId: results.id }, provenance(400));
    expect(moved.completedAt).toBe(100);
    expect(moved.categoryId).toBe(results.id);
  });

  it("serializes concurrent writes and reloads the persisted state", async () => {
    const [first, second, third] = await Promise.all([
      store.createItem({ markdown: "First" }, provenance(10)),
      store.createItem({ markdown: "Second" }, provenance(20)),
      store.createItem({ markdown: "Third" }, provenance(30)),
    ]);
    expect([first.id, second.id, third.id]).toEqual(["td-1", "td-2", "td-3"]);

    const reloaded = new TodoStore(path);
    expect((await reloaded.snapshot()).items.map((item) => item.id)).toEqual(["td-1", "td-2", "td-3"]);
  });

  it("filters completed items through an explicit time zone", async () => {
    const item = await store.createItem({ markdown: "Late task" }, provenance(Date.UTC(2026, 7, 13, 5, 30)));
    await store.setItemStatus(item.id, "done", provenance(Date.UTC(2026, 7, 13, 6, 30)));

    expect(await store.listItems({ completedOn: "2026-08-12", timeZone: "America/Los_Angeles" })).toHaveLength(1);
    expect(await store.listItems({ completedOn: "2026-08-13", timeZone: "America/Los_Angeles" })).toEqual([]);
    expect(
      (await store.listItems({ completedOn: "2026-08-13", timeZone: "UTC" })).map((candidate) => candidate.id),
    ).toEqual([item.id]);
  });

  it("blocks populated category archival instead of silently moving or deleting items", async () => {
    const category = await store.createCategory({ name: "Slack" }, provenance(10));
    const item = await store.createItem({ markdown: "Reply", categoryId: category.id }, provenance(20));

    await expect(store.archiveCategory(category.id, provenance(30))).rejects.toMatchObject({ code: "conflict" });
    await store.setItemArchived(item.id, true, provenance(40));
    expect((await store.archiveCategory(category.id, provenance(50))).archivedAt).toBe(50);
    await expect(store.setItemArchived(item.id, false, provenance(55))).rejects.toMatchObject({ code: "conflict" });
    expect((await store.restoreCategory(category.id, provenance(60))).archivedAt).toBeUndefined();
    expect((await store.setItemArchived(item.id, false, provenance(65))).archivedAt).toBeUndefined();
    await expect(store.archiveCategory(TODO_INBOX_CATEGORY_ID, provenance(70))).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("keeps an optional due date through status changes and refuses bad stored ones", async () => {
    // The due date is plain item metadata: completing and reopening keep it, setting null clears it.
    const item = await store.createItem({ markdown: "Book flights", due: "2026-10-20" }, provenance(10));
    expect(item.due).toBe("2026-10-20");
    await store.setItemStatus(item.id, "done", provenance(20));
    expect((await store.setItemStatus(item.id, "todo", provenance(30))).due).toBe("2026-10-20");
    expect((await store.setItemDue(item.id, "2026-10-21T09:15", provenance(40))).due).toBe("2026-10-21T09:15");
    expect((await store.setItemDue(item.id, null, provenance(50))).due).toBeUndefined();
    await expect(store.setItemDue(item.id, "tomorrow", provenance(60))).rejects.toMatchObject({ code: "invalid" });

    // A hand-edited store with an impossible due date is refused rather than rewritten.
    const state = JSON.parse(readFileSync(path, "utf-8"));
    state.items[0].due = "2026-13-01";
    const raw = JSON.stringify(state);
    writeFileSync(path, raw, "utf-8");
    await expect(new TodoStore(path).snapshot()).rejects.toMatchObject({ code: "corrupt_store" });
    expect(readFileSync(path, "utf-8")).toBe(raw);
  });

  it("keeps quest links as many-to-many metadata that never changes to-do status", async () => {
    // Links are loose metadata: a to-do can link several quests, a quest can be
    // linked from several to-dos, and linking leaves status untouched.
    const release = await store.createItem({ markdown: "Ship the release" }, provenance(10));
    const notes = await store.createItem({ markdown: "Write release notes" }, provenance(11));

    const linked = await store.linkItemQuests(release.id, { addQuestIds: ["q-7", "q-9", "q-7"] }, provenance(20));
    await store.linkItemQuests(notes.id, { addQuestIds: ["q-9"] }, provenance(21));
    expect(linked).toMatchObject({ questIds: ["q-7", "q-9"], status: "todo", updatedAt: 20 });
    expect((await store.findItemsByQuest("q-9")).map((item) => item.id)).toEqual([release.id, notes.id]);

    // Re-linking an existing quest is a no-op rather than an edit.
    const unchanged = await store.linkItemQuests(release.id, { addQuestIds: ["q-9"] }, provenance(30));
    expect(unchanged.updatedAt).toBe(20);

    // Removing the last link drops the field so unlinked items keep their old shape.
    await store.linkItemQuests(notes.id, { removeQuestIds: ["q-9"] }, provenance(40));
    expect((await store.getItem(notes.id)).questIds).toBeUndefined();
    expect((await store.findItemsByQuest("q-9")).map((item) => item.id)).toEqual([release.id]);

    // Archived to-dos are only found when explicitly requested.
    await store.setItemArchived(release.id, true, provenance(50));
    expect(await store.findItemsByQuest("q-9")).toEqual([]);
    expect((await store.findItemsByQuest("q-9", true)).map((item) => item.id)).toEqual([release.id]);

    await expect(store.linkItemQuests(release.id, { addQuestIds: ["42"] }, provenance(60))).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(store.linkItemQuests(release.id, {}, provenance(60))).rejects.toMatchObject({ code: "invalid" });
  });

  it("drops retired proposals and grants from a schema-v2 list after keeping an exact copy", async () => {
    // Proposals and grants are retired. Loading a v2 list backs up the original file before the
    // first write, then keeps every item, category and its provenance, including changes made
    // through a proposal or grant, and nothing else.
    const fromProposal = {
      actor: { kind: "session", sessionId: "agent-1", label: "Briefing" },
      authorization: { kind: "proposal_approval", proposalId: "tp-3" },
      at: 30,
    };
    const v2 = {
      schemaVersion: 2,
      revision: 9,
      updatedAt: 90,
      nextItemId: 2,
      nextCategoryId: 1,
      nextProposalId: 5,
      nextGrantId: 2,
      categories: [
        {
          id: "cat-inbox",
          name: "Inbox",
          createdAt: 1,
          updatedAt: 1,
          createdBy: provenance(1, "bootstrap"),
          lastModifiedBy: provenance(1, "bootstrap"),
        },
      ],
      items: [
        {
          id: "td-1",
          markdown: "Review the PR",
          rank: 1024,
          categoryId: "cat-inbox",
          status: "todo",
          createdAt: 30,
          updatedAt: 30,
          statusChangedAt: 30,
          createdBy: fromProposal,
          lastModifiedBy: fromProposal,
        },
      ],
      proposals: [
        {
          id: "tp-4",
          mutation: { action: "item:add", input: { markdown: "Stale ask" } },
          status: "pending",
          createdAt: 40,
          updatedAt: 40,
          requestedBy: { kind: "session", sessionId: "agent-1" },
        },
      ],
      grants: [
        {
          id: "tg-1",
          principal: { kind: "session", id: "agent-1" },
          actions: ["item:status"],
          categoryIds: ["cat-inbox"],
          createdAt: 20,
          updatedAt: 20,
          createdBy: provenance(20),
          lastModifiedBy: provenance(20),
        },
      ],
    };
    const raw = JSON.stringify(v2, null, 2);
    writeFileSync(path, raw, "utf-8");

    const migrated = await new TodoStore(path).snapshot();
    expect(migrated).toEqual({
      schemaVersion: 3,
      revision: 9,
      updatedAt: 90,
      nextItemId: 2,
      nextCategoryId: 1,
      categories: v2.categories,
      items: v2.items,
    });
    expect(readFileSync(`${path}.schema-v2.backup`, "utf-8")).toBe(raw);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(migrated);

    // A different copy already in the backup's place is never overwritten, and neither is the list.
    writeFileSync(path, raw.replace("Review the PR", "Review the other PR"), "utf-8");
    await expect(new TodoStore(path).snapshot()).rejects.toMatchObject({ code: "corrupt_store" });
    expect(readFileSync(`${path}.schema-v2.backup`, "utf-8")).toBe(raw);
    expect(readFileSync(path, "utf-8")).toContain("Review the other PR");
  });

  it("refuses to overwrite structurally corrupt schema-v2 state", async () => {
    const corruptV2 = {
      schemaVersion: 2,
      revision: 1,
      updatedAt: 1,
      nextItemId: 2,
      nextCategoryId: 1,
      nextProposalId: 1,
      nextGrantId: 1,
      categories: [
        {
          id: "cat-inbox",
          name: "Inbox",
          createdAt: 1,
          updatedAt: 1,
          createdBy: provenance(1, "bootstrap"),
          lastModifiedBy: provenance(1, "bootstrap"),
        },
      ],
      items: [
        {
          id: "td-1",
          markdown: "Orphaned v2 item",
          rank: 1024,
          categoryId: "cat-missing",
          status: "todo",
          createdAt: 1,
          updatedAt: 1,
          statusChangedAt: 1,
          createdBy: provenance(1),
          lastModifiedBy: provenance(1),
        },
      ],
      proposals: [],
      grants: [],
    };
    const raw = JSON.stringify(corruptV2);
    writeFileSync(path, raw, "utf-8");
    const corrupt = new TodoStore(path);

    await expect(corrupt.snapshot()).rejects.toMatchObject({ code: "corrupt_store" });
    await expect(corrupt.createItem({ markdown: "Do not append" }, provenance(2))).rejects.toMatchObject({
      code: "corrupt_store",
    });
    expect(readFileSync(path, "utf-8")).toBe(raw);
  });

  it("refuses to overwrite corrupt durable data", async () => {
    writeFileSync(path, "{not-json", "utf-8");
    const corrupt = new TodoStore(path);

    await expect(corrupt.snapshot()).rejects.toBeInstanceOf(TodoStoreError);
    await expect(corrupt.createItem({ markdown: "Do not write" }, provenance(10))).rejects.toMatchObject({
      code: "corrupt_store",
    });
    expect(readFileSync(path, "utf-8")).toBe("{not-json");
  });
});
