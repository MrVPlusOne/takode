import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TodoMutationProvenance } from "../shared/todo-types.js";
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
  // Every test uses a disposable path so destructive coverage can never touch
  // the user's durable ~/.companion/todos store.
  dir = mkdtempSync(join(tmpdir(), "takode-todo-store-test-"));
  path = join(dir, "todo-list.json");
  store = new TodoStore(path);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TodoStore", () => {
  it("keeps exactly the current status timestamps and reversible archive state", async () => {
    const created = await store.createItem(
      { titleMarkdown: "[Reply](https://example.com/thread)", status: "todo" },
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

  it("serializes concurrent writes and reloads the persisted state", async () => {
    const [first, second, third] = await Promise.all([
      store.createItem({ titleMarkdown: "First" }, provenance(10)),
      store.createItem({ titleMarkdown: "Second" }, provenance(20)),
      store.createItem({ titleMarkdown: "Third" }, provenance(30)),
    ]);
    expect([first.id, second.id, third.id]).toEqual(["td-1", "td-2", "td-3"]);

    const reloaded = new TodoStore(path);
    expect((await reloaded.snapshot()).items.map((item) => item.id)).toEqual(["td-1", "td-2", "td-3"]);
  });

  it("finds authored Markdown links without a separate link or external-key field", async () => {
    await store.createItem(
      {
        titleMarkdown: "Reply to **Alice**",
        detailsMarkdown: "Original: [Slack thread](https://example.slack.com/archives/C1/p123)",
      },
      provenance(10),
    );

    expect((await store.findItemsByLink("https://example.slack.com/archives/C1/p123"))[0]?.id).toBe("td-1");
    expect((await store.listItems({ search: "alice" }))[0]?.id).toBe("td-1");
    expect((await store.listItems({ search: "archives/c1/p123" }))[0]?.id).toBe("td-1");
  });

  it("filters completed items through an explicit time zone", async () => {
    const item = await store.createItem({ titleMarkdown: "Late task" }, provenance(Date.UTC(2026, 7, 13, 5, 30)));
    await store.setItemStatus(item.id, "done", provenance(Date.UTC(2026, 7, 13, 6, 30)));

    expect(await store.listItems({ completedOn: "2026-08-12", timeZone: "America/Los_Angeles" })).toHaveLength(1);
    expect(await store.listItems({ completedOn: "2026-08-13", timeZone: "America/Los_Angeles" })).toEqual([]);
    expect(
      (await store.listItems({ completedOn: "2026-08-13", timeZone: "UTC" })).map((candidate) => candidate.id),
    ).toEqual([item.id]);
  });

  it("blocks populated category archival instead of silently moving or deleting items", async () => {
    const category = await store.createCategory({ name: "Slack" }, provenance(10));
    const item = await store.createItem({ titleMarkdown: "Reply", categoryId: category.id }, provenance(20));

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
    expect(
      await store.matchingGrant([{ kind: "cron", id: "slack-sweep" }], "item:add", [TODO_INBOX_CATEGORY_ID]),
    ).toBeNull();
  });

  it("applies an approved proposal while preserving requester and approval provenance", async () => {
    const proposal = await store.createProposal(
      { action: "item:add", input: { titleMarkdown: "[Review result](quest:q-42)" } },
      { kind: "session", sessionId: "agent-1", label: "Worker" },
    );
    const resolved = await store.resolveProposal(proposal.id, "approved", provenance(100));

    expect(resolved.proposal.status).toBe("approved");
    expect(resolved.item?.createdBy).toMatchObject({
      actor: { kind: "session", sessionId: "agent-1" },
      authorization: { kind: "proposal_approval", proposalId: proposal.id },
    });
  });

  it("refuses to overwrite corrupt durable data", async () => {
    writeFileSync(path, "{not-json", "utf-8");
    const corrupt = new TodoStore(path);

    await expect(corrupt.snapshot()).rejects.toBeInstanceOf(TodoStoreError);
    await expect(corrupt.createItem({ titleMarkdown: "Do not write" }, provenance(10))).rejects.toMatchObject({
      code: "corrupt_store",
    });
    expect(readFileSync(path, "utf-8")).toBe("{not-json");
  });
});
