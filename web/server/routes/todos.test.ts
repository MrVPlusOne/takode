import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodoStore } from "../todo-store.js";
import type { RouteContext } from "./context.js";
import { createTodoRoutes } from "./todos.js";

let dir: string;
let store: TodoStore;
let app: Hono;
let optionalCaller: any = null;
let bridgeSession: any;
const broadcastGlobal = vi.fn();
// Quest lookups read this fixture, never the real Questmaster store.
let quests: Array<Record<string, unknown>> = [];

function caller(overrides: Record<string, unknown> = {}) {
  return {
    callerId: "session-1",
    caller: {
      sessionId: "session-1",
      sessionNum: 7,
      name: "Worker 7",
      state: "running",
      cwd: "/repo",
      ...overrides,
    },
  };
}

function makeContext(): RouteContext {
  const ctx = {
    wsBridge: { getSession: () => bridgeSession, broadcastGlobal },
    authenticateCompanionCallerOptional: () => optionalCaller,
  };
  return ctx as unknown as RouteContext;
}

async function jsonRequest(path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  // Route mutations are always pointed at an isolated disposable store.
  dir = mkdtempSync(join(tmpdir(), "takode-todo-routes-test-"));
  store = new TodoStore(join(dir, "todo-list.json"));
  optionalCaller = null;
  bridgeSession = { messageHistory: [] };
  broadcastGlobal.mockReset();
  quests = [];
  app = new Hono();
  app.route(
    "/",
    createTodoRoutes(makeContext(), store, async () => quests as any),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("to-do routes", () => {
  it("treats direct browser UI mutations as authorized server-side Markdown changes", async () => {
    const response = await jsonRequest("/todos/items", "POST", {
      markdown: "[Review result](quest:q-42)\nFull context",
      status: "doing",
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.item).toMatchObject({
      id: "td-1",
      status: "doing",
      markdown: "[Review result](quest:q-42)\nFull context",
    });
    expect(body.item.createdBy.authorization.kind).toBe("ui");
    expect(body.state.schemaVersion).toBe(3);
    expect(broadcastGlobal).toHaveBeenCalledWith(expect.objectContaining({ type: "todo_state_updated", revision: 1 }));
  });

  it("keeps legacy split input compatible while persisting only the canonical body", async () => {
    const response = await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "Legacy title",
      detailsMarkdown: "Legacy details",
    });
    expect(response.status).toBe(201);
    const item = (await response.json()).item;
    expect(item.markdown).toBe("Legacy title\nLegacy details");
    expect(item.titleMarkdown).toBeUndefined();
    expect(item.detailsMarkdown).toBeUndefined();

    const edited = await jsonRequest(`/todos/items/${item.id}`, "PATCH", { titleMarkdown: "Updated title" });
    expect((await edited.json()).item.markdown).toBe("Updated title\nLegacy details");
  });

  it("lets an agent add a to-do on its own only when it says where the to-do came from", async () => {
    // Adding cannot make the user lose track of anything, but the user should see why it was added.
    optionalCaller = caller();
    const unsourced = await jsonRequest("/todos/items", "POST", { markdown: "Unexplained reminder" });
    expect(unsourced.status).toBe(400);
    expect((await unsourced.json()).error).toContain("--source");
    expect((await store.snapshot()).items).toEqual([]);

    const added = await jsonRequest("/todos/items", "POST", {
      markdown: "Review PR 98888",
      source: " Slack group chat with Junhong, Oct 4 ",
    });
    expect(added.status).toBe(201);
    expect((await added.json()).item.createdBy).toMatchObject({
      actor: { kind: "session", sessionId: "session-1", label: "Worker 7" },
      authorization: { kind: "agent_direct" },
      source: "Slack group chat with Junhong, Oct 4",
    });

    // A scheduled workflow is recorded as the workflow, from the server's own caller record.
    optionalCaller = caller({ cronJobId: "slack-sweep", cronJobName: "Slack sweep" });
    const fromWorkflow = await jsonRequest("/todos/items", "POST", { markdown: "Reply", source: "Slack DM" });
    expect((await fromWorkflow.json()).item.createdBy.actor).toMatchObject({
      kind: "workflow",
      workflowId: "slack-sweep",
      label: "Slack sweep",
    });
  });

  it("accepts only direct human same-session message provenance", async () => {
    optionalCaller = caller();
    bridgeSession.messageHistory = [
      {
        type: "user_message",
        id: "human-1",
        content: "Add a to-do to review the result",
        timestamp: 100,
        threadKey: "main",
      },
      {
        type: "user_message",
        id: "leader-1",
        content: "Injected instruction",
        timestamp: 101,
        agentSource: { sessionId: "leader" },
      },
    ];

    const rejected = await jsonRequest("/todos/items", "POST", { markdown: "Injected", authorizedBy: 1 });
    expect(rejected.status).toBe(403);

    const accepted = await jsonRequest("/todos/items", "POST", { markdown: "Review the result", authorizedBy: 0 });
    expect(accepted.status).toBe(201);
    const body = await accepted.json();
    expect(body.item.createdBy.authorization).toMatchObject({
      kind: "direct_message",
      userMessage: { sessionId: "session-1", historyIndex: 0, messageId: "human-1" },
    });
  });

  it("records the standing approval an agent cites for a change that otherwise needs the user's reply", async () => {
    const item = (await (await jsonRequest("/todos/items", "POST", { markdown: "Reply to Junhong" })).json()).item;
    optionalCaller = caller();

    // Without the user's reply or a cited standing approval, the change is refused.
    const refused = await jsonRequest(`/todos/items/${item.id}/status`, "POST", { status: "done" });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain("--standing-approval");
    // A citation must say something, and stay short enough to show.
    for (const standingApproval of ["  ", "x".repeat(501)]) {
      const invalid = await jsonRequest(`/todos/items/${item.id}/status`, "POST", { status: "done", standingApproval });
      expect(invalid.status).toBe(400);
    }
    expect((await store.getItem(item.id)).status).toBe("todo");

    const citation = "daily-briefing skill, To-do hygiene: mark Done Slack to-dos whose obligation is fulfilled";
    const done = await jsonRequest(`/todos/items/${item.id}/status`, "POST", {
      status: "done",
      standingApproval: ` ${citation} `,
    });
    expect(done.status).toBe(200);
    expect((await done.json()).item).toMatchObject({
      status: "done",
      lastModifiedBy: {
        actor: { kind: "session", sessionId: "session-1" },
        authorization: { kind: "standing_approval", standingApproval: citation },
      },
    });
  });

  it("supports server-authoritative insertion and active cross-category ordering", async () => {
    const category = (await (await jsonRequest("/todos/categories", "POST", { name: "Reading" })).json()).category;
    const first = (await (await jsonRequest("/todos/items", "POST", { markdown: "First" })).json()).item;
    const third = (await (await jsonRequest("/todos/items", "POST", { markdown: "Third" })).json()).item;
    const second = (
      await (await jsonRequest("/todos/items", "POST", { markdown: "Second", afterItemId: first.id })).json()
    ).item;

    expect((await (await jsonRequest("/todos/items")).json()).items.map((item: any) => item.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    const moved = await jsonRequest(`/todos/items/${third.id}/move`, "POST", {
      categoryId: category.id,
    });
    expect((await moved.json()).item).toMatchObject({ categoryId: category.id, rank: 1024 });

    const reordered = await jsonRequest(`/todos/items/${second.id}/move`, "POST", { beforeItemId: first.id });
    expect(reordered.status).toBe(200);
    expect(
      (await (await jsonRequest("/todos/items?category=cat-inbox")).json()).items.map((item: any) => item.id),
    ).toEqual([second.id, first.id]);
  });

  it("keeps Done completion grouping authoritative when changing category", async () => {
    const category = (await (await jsonRequest("/todos/categories", "POST", { name: "Results" })).json()).category;
    const first = (await (await jsonRequest("/todos/items", "POST", { markdown: "Done first", status: "done" })).json())
      .item;
    const second = (
      await (await jsonRequest("/todos/items", "POST", { markdown: "Done second", status: "done" })).json()
    ).item;
    const rejected = await jsonRequest(`/todos/items/${second.id}/move`, "POST", { beforeItemId: first.id });
    expect(rejected.status).toBe(409);

    const moved = await jsonRequest(`/todos/items/${first.id}/move`, "POST", { categoryId: category.id });
    expect((await moved.json()).item).toMatchObject({ categoryId: category.id, completedAt: first.completedAt });
  });

  it("returns a short-lived browser completion receipt and atomically restores the prior active position", async () => {
    const first = (await (await jsonRequest("/todos/items", "POST", { markdown: "First" })).json()).item;
    const second = (await (await jsonRequest("/todos/items", "POST", { markdown: "Second", status: "doing" })).json())
      .item;
    await jsonRequest("/todos/items", "POST", { markdown: "Third" });

    const completedResponse = await jsonRequest(`/todos/items/${second.id}/status`, "POST", { status: "done" });
    expect(completedResponse.status).toBe(200);
    const completed = await completedResponse.json();
    expect(completed.item).toMatchObject({ status: "done" });
    expect(completed.completionUndo).toMatchObject({ itemId: second.id });
    expect(completed.completionUndo.token).toEqual(expect.any(String));

    const undoResponse = await jsonRequest(`/todos/items/${second.id}/completion-undo`, "POST", {
      token: completed.completionUndo.token,
    });
    expect(undoResponse.status).toBe(200);
    const undone = await undoResponse.json();
    expect(undone.item).toMatchObject({ status: "doing", categoryId: first.categoryId, rank: second.rank });
    expect(undone.item.completedAt).toBeUndefined();
    expect(
      undone.state.items
        .filter((item: any) => item.status !== "done")
        .sort((a: any, b: any) => a.rank - b.rank)
        .map((item: any) => item.markdown),
    ).toEqual(["First", "Second", "Third"]);

    expect(
      (
        await jsonRequest(`/todos/items/${second.id}/completion-undo`, "POST", {
          token: completed.completionUndo.token,
        })
      ).status,
    ).toBe(409);
  });

  it("keeps category archival reversible and refuses silent item loss", async () => {
    const category = (await (await jsonRequest("/todos/categories", "POST", { name: "Results" })).json()).category;
    const item = (
      await (await jsonRequest("/todos/items", "POST", { markdown: "Review", categoryId: category.id })).json()
    ).item;

    expect((await jsonRequest(`/todos/categories/${category.id}/archive`, "POST", {})).status).toBe(409);
    expect((await jsonRequest(`/todos/items/${item.id}/archive`, "POST", {})).status).toBe(200);
    expect((await jsonRequest(`/todos/categories/${category.id}/archive`, "POST", {})).status).toBe(200);
    expect((await jsonRequest(`/todos/items/${item.id}/restore`, "POST", {})).status).toBe(409);
    expect((await jsonRequest(`/todos/categories/${category.id}/restore`, "POST", {})).status).toBe(200);
    expect((await jsonRequest(`/todos/items/${item.id}/restore`, "POST", {})).status).toBe(200);
  });

  it("keeps repeated list/find payloads compact and reserves the raw body and provenance for show", async () => {
    await jsonRequest("/todos/items", "POST", {
      markdown: "[Reply](https://example.com/thread)\nLong private details",
    });

    const listBody = await (await jsonRequest("/todos/items")).json();
    expect(listBody.items[0]).toMatchObject({
      id: "td-1",
      titleMarkdown: "[Reply](https://example.com/thread)",
      categoryName: "Inbox",
    });
    expect(listBody.items[0].markdown).toBeUndefined();
    expect(listBody.items[0].rank).toBeUndefined();
    expect(listBody.items[0].lastModifiedBy).toBeUndefined();
    expect(listBody.state).toBeUndefined();

    const findBody = await (await jsonRequest("/todos/find?link=https%3A%2F%2Fexample.com%2Fthread")).json();
    expect(findBody.items[0].markdown).toBeUndefined();

    const showBody = await (await jsonRequest("/todos/items/td-1")).json();
    expect(showBody.item.markdown).toBe("[Reply](https://example.com/thread)\nLong private details");
    expect(showBody.item.lastModifiedBy.authorization.kind).toBe("ui");
  });

  it("links quests as metadata, shows their live status from both sides, and keeps to-do status unchanged", async () => {
    quests = [
      { questId: "q-7", title: "Build the export", status: "done" },
      { questId: "q-8", title: "Dropped idea", status: "done", cancelled: true },
      { questId: "q-9", title: "Polish the export", status: "in_progress" },
    ];
    const item = (await (await jsonRequest("/todos/items", "POST", { markdown: "Ship export" })).json()).item;

    const missing = await jsonRequest(`/todos/items/${item.id}/links`, "POST", { addQuestIds: ["q-404"] });
    expect(missing.status).toBe(404);

    const linked = await jsonRequest(`/todos/items/${item.id}/links`, "POST", { addQuestIds: ["q-7", "q-8", "q-9"] });
    expect(linked.status).toBe(200);
    expect((await linked.json()).item).toMatchObject({ questIds: ["q-7", "q-8", "q-9"], status: "todo" });

    // Compact reads carry each quest's current status; a quest deleted later reads as missing.
    quests = quests.filter((quest) => quest.questId !== "q-9");
    const listBody = await (await jsonRequest("/todos/items")).json();
    expect(listBody.items[0].linkedQuests).toEqual([
      { questId: "q-7", status: "done" },
      { questId: "q-8", status: "cancelled" },
      { questId: "q-9", status: "missing" },
    ]);

    // Show adds titles so an agent can judge the to-do without opening each quest.
    const showBody = await (await jsonRequest(`/todos/items/${item.id}`)).json();
    expect(showBody.linkedQuests[0]).toEqual({ questId: "q-7", status: "done", title: "Build the export" });

    // The To-dos UI reads every linked quest once, with titles, for its quest chips.
    const uiBody = await (await jsonRequest("/todos/linked-quests")).json();
    expect(uiBody.quests).toEqual([
      { questId: "q-7", status: "done", title: "Build the export" },
      { questId: "q-8", status: "cancelled", title: "Dropped idea" },
      { questId: "q-9", status: "missing" },
    ]);

    // The reverse lookup is what quest show uses to list linked to-dos.
    const findBody = await (await jsonRequest("/todos/find?quest=q-7")).json();
    expect(findBody.items.map((found: any) => found.id)).toEqual([item.id]);

    // Unlinking a quest that no longer exists still works.
    const unlinked = await jsonRequest(`/todos/items/${item.id}/links`, "POST", { removeQuestIds: ["q-9"] });
    expect((await unlinked.json()).item.questIds).toEqual(["q-7", "q-8"]);
  });

  it("lets agents link quests on their own judgment", async () => {
    // Quest links are informational metadata, so they cannot make the user lose track of anything.
    quests = [{ questId: "q-7", title: "Build the export", status: "done" }];
    const item = (await (await jsonRequest("/todos/items", "POST", { markdown: "Ship export" })).json()).item;

    optionalCaller = caller();
    const missing = await jsonRequest(`/todos/items/${item.id}/links`, "POST", { addQuestIds: ["q-404"] });
    expect(missing.status).toBe(404);
    const linked = await jsonRequest(`/todos/items/${item.id}/links`, "POST", { addQuestIds: ["q-7"] });
    expect(linked.status).toBe(200);
    expect((await linked.json()).item.lastModifiedBy).toMatchObject({
      actor: { kind: "session", sessionId: "session-1" },
      authorization: { kind: "agent_direct" },
    });
    expect((await store.getItem(item.id)).questIds).toEqual(["q-7"]);
  });

  it("lets agents make low-risk changes directly and requires approval for changes that could lose track", async () => {
    // The split: adding text, starting or reopening a to-do and restoring are low-risk; rewording or
    // removing text, completing, archiving, moving and category changes need the user's approval.
    const item = (
      await (await jsonRequest("/todos/items", "POST", { markdown: "Review PR 98888\nAsked by Junhong" })).json()
    ).item;
    const done = (await (await jsonRequest("/todos/items", "POST", { markdown: "Old task", status: "done" })).json())
      .item;
    const archived = (await (await jsonRequest("/todos/items", "POST", { markdown: "Parked" })).json()).item;
    await jsonRequest(`/todos/items/${archived.id}/archive`, "POST", {});

    optionalCaller = caller();
    const allowed: Array<[string, string, unknown]> = [
      [
        `/todos/items/${item.id}`,
        "PATCH",
        { markdown: "Review PR 98888\nAsked by Junhong\nWeights question answered" },
      ],
      [`/todos/items/${item.id}/status`, "POST", { status: "doing" }],
      [`/todos/items/${done.id}/status`, "POST", { status: "todo" }],
      [`/todos/items/${archived.id}/restore`, "POST", {}],
    ];
    for (const [path, method, body] of allowed) {
      const response = await jsonRequest(path, method, body);
      expect(response.status, path).toBe(200);
      expect((await response.json()).item.lastModifiedBy.authorization.kind).toBe("agent_direct");
    }

    const needsApproval: Array<[string, string, unknown]> = [
      // Renaming the title or dropping a line the user wrote.
      [
        `/todos/items/${item.id}`,
        "PATCH",
        { markdown: "Review PR 98899\nAsked by Junhong\nWeights question answered" },
      ],
      [`/todos/items/${item.id}`, "PATCH", { markdown: "Review PR 98888\nWeights question answered" }],
      [`/todos/items/${item.id}/status`, "POST", { status: "done" }],
      [`/todos/items/${item.id}/archive`, "POST", {}],
      [`/todos/items/${item.id}/move`, "POST", { beforeItemId: done.id }],
      ["/todos/categories", "POST", { name: "New category" }],
      ["/todos/categories/cat-inbox", "PATCH", { name: "Renamed" }],
    ];
    for (const [path, method, body] of needsApproval) {
      const response = await jsonRequest(path, method, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect((await response.json()).error).toContain("--authorized-by");
    }
    expect((await store.getItem(item.id)).markdown).toBe(
      "Review PR 98888\nAsked by Junhong\nWeights question answered",
    );
  });

  it("sets, changes and clears due dates; agents may only give a to-do its first one", async () => {
    // A due date can come with the new to-do, or be set later; it shows in compact lists.
    const dated = (
      await (await jsonRequest("/todos/items", "POST", { markdown: "Book flights", due: "2026-10-20" })).json()
    ).item;
    expect(dated.due).toBe("2026-10-20");
    const item = (await (await jsonRequest("/todos/items", "POST", { markdown: "Send the report" })).json()).item;
    expect((await jsonRequest(`/todos/items/${item.id}/due`, "POST", { due: "2026-02-30" })).status).toBe(400);
    expect((await jsonRequest(`/todos/items/${item.id}/due`, "POST", { due: "2026-10-16T25:00" })).status).toBe(400);

    optionalCaller = caller();
    // First due date: low-risk, made on the agent's own judgment.
    const first = await jsonRequest(`/todos/items/${item.id}/due`, "POST", { due: "2026-10-16T14:30" });
    expect(first.status).toBe(200);
    const firstItem = (await first.json()).item;
    expect(firstItem.due).toBe("2026-10-16T14:30");
    expect(firstItem.lastModifiedBy.authorization.kind).toBe("agent_direct");
    // Changing or clearing a deadline could lose it, so it needs the user's approval.
    for (const due of ["2026-10-17", null]) {
      const response = await jsonRequest(`/todos/items/${item.id}/due`, "POST", { due });
      expect(response.status, String(due)).toBe(403);
    }

    optionalCaller = null;
    const list = await (await jsonRequest("/todos/items")).json();
    expect(list.items.find((entry: { id: string }) => entry.id === item.id).due).toBe("2026-10-16T14:30");
    // The To-dos button's count and to-do link markers read only each to-do's status, due date
    // and archive time; the browser decides which are overdue.
    await jsonRequest(`/todos/items/${dated.id}/status`, "POST", { status: "done" });
    const summaries = await (await jsonRequest("/todos/item-summaries")).json();
    expect(summaries.items[dated.id]).toEqual({ status: "done", due: "2026-10-20" });
    expect(summaries.items[item.id]).toEqual({ status: "todo", due: "2026-10-16T14:30" });
    expect(summaries.revision).toBe((await store.snapshot()).revision);

    const cleared = await (await jsonRequest(`/todos/items/${item.id}/due`, "POST", { due: null })).json();
    expect(cleared.item.due).toBeUndefined();
    expect((await (await jsonRequest("/todos/item-summaries")).json()).items[item.id]).toEqual({ status: "todo" });
  });
});
