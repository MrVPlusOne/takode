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
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.items[0]?.markdown).toBe("  **Preserve me**  \n  detail line\nsecond line  ");
    expect(migrated.items[1]?.markdown).toBe("   \nDerived title\nremaining detail");
    expect(migrated.items.map((item) => item.rank)).toEqual([2048, 1024]);
    expect(migrated.proposals[0]?.mutation).toEqual({
      action: "item:edit",
      itemId: "td-1",
      input: { markdown: "  **Preserve me**  \nreplacement" },
    });
    expect(migrated.proposals[1]?.mutation).toEqual({
      action: "item:edit",
      itemId: "td-2",
      input: { markdown: "   \nDerived title\nremaining detail" },
    });
    expect(readFileSync(`${path}.schema-v1.backup`, "utf-8")).toBe(raw);
    const persisted = JSON.parse(readFileSync(path, "utf-8"));
    expect(persisted.schemaVersion).toBe(2);
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

  it("matches grants only for the server-derived principal, action, and full category scope", async () => {
    const slack = await store.createCategory({ name: "Slack" }, provenance(10));
    const grant = await store.createGrant(
      {
        principal: { kind: "cron", id: "slack-sweep", label: "Slack sweep" },
        actions: ["item:add", "item:status"],
        categoryIds: [slack.id],
      },
      provenance(20),
    );

    expect(await store.matchingGrant([{ kind: "cron", id: "slack-sweep" }], "item:add", [slack.id])).toMatchObject({
      id: grant.id,
    });
    expect(await store.matchingGrant([{ kind: "cron", id: "other" }], "item:add", [slack.id])).toBeNull();
    expect(await store.matchingGrant([{ kind: "cron", id: "slack-sweep" }], "item:move", [slack.id])).toBeNull();
  });

  it("canonicalizes approved proposals to one Markdown body while preserving provenance", async () => {
    const proposal = await store.createProposal(
      { action: "item:add", input: { titleMarkdown: "[Review result](quest:q-42)", detailsMarkdown: "Context" } },
      { kind: "session", sessionId: "agent-1", label: "Worker" },
    );
    expect(proposal.mutation).toMatchObject({
      action: "item:add",
      input: { markdown: "[Review result](quest:q-42)\nContext" },
    });
    const resolved = await store.resolveProposal(proposal.id, "approved", provenance(100));

    expect(resolved.proposal.status).toBe("approved");
    expect(resolved.item?.markdown).toBe("[Review result](quest:q-42)\nContext");
    expect(resolved.item?.createdBy).toMatchObject({
      actor: { kind: "session", sessionId: "agent-1" },
      authorization: { kind: "proposal_approval", proposalId: proposal.id },
    });
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
