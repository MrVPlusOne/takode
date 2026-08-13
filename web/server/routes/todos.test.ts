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
let requiredCaller: any = null;
let bridgeSession: any;
const broadcastGlobal = vi.fn();

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
    launcher: { listSessions: () => [] },
    wsBridge: { getSession: () => bridgeSession, broadcastGlobal },
    authenticateCompanionCallerOptional: () => optionalCaller,
    authenticateTakodeCaller: () => requiredCaller ?? { response: new Response("forbidden", { status: 403 }) },
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
  requiredCaller = null;
  bridgeSession = { messageHistory: [] };
  broadcastGlobal.mockReset();
  app = new Hono();
  app.route("/", createTodoRoutes(makeContext(), store));
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
    expect(body.state.schemaVersion).toBe(2);
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

  it("fails closed for an agent mutation without a direct user message or matching grant", async () => {
    optionalCaller = caller();

    const response = await jsonRequest("/todos/items", "POST", { markdown: "Unapproved reminder" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ canPropose: true, requiredAction: "item:add" });
    expect((await store.snapshot()).items).toEqual([]);
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

  it("uses the authenticated cronJobId as a trustworthy scoped workflow principal", async () => {
    const category = (await (await jsonRequest("/todos/categories", "POST", { name: "Slack" })).json()).category;
    const grantResponse = await jsonRequest("/todos/grants", "POST", {
      principal: { kind: "cron", id: "slack-sweep", label: "Slack sweep" },
      actions: ["item:add"],
      categoryIds: [category.id],
    });
    expect(grantResponse.status).toBe(201);

    optionalCaller = caller({ cronJobId: "slack-sweep", cronJobName: "Slack sweep" });
    const accepted = await jsonRequest("/todos/items", "POST", {
      markdown: "[Reply to thread](https://example.slack.com/thread)",
      categoryId: category.id,
    });
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).item.createdBy).toMatchObject({
      actor: { kind: "workflow", workflowId: "slack-sweep" },
      authorization: { kind: "grant", grantId: "tg-1" },
    });

    const denied = await jsonRequest("/todos/items", "POST", { markdown: "Out of scope", categoryId: "cat-inbox" });
    expect(denied.status).toBe(403);
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

  it("lets agents create canonical proposals without mutating the real list until user approval", async () => {
    requiredCaller = caller();
    const proposed = await jsonRequest("/todos/proposals", "POST", {
      mutation: { action: "item:add", input: { titleMarkdown: "Read the important result" } },
    });
    expect(proposed.status).toBe(201);
    const proposal = (await proposed.json()).proposal;
    expect(proposal.mutation.input).toMatchObject({ markdown: "Read the important result" });
    expect((await store.snapshot()).items).toEqual([]);

    optionalCaller = null;
    const approved = await jsonRequest(`/todos/proposals/${proposal.id}/approve`, "POST", {});
    expect(approved.status).toBe(200);
    const body = await approved.json();
    expect(body.item.markdown).toBe("Read the important result");
    expect(body.item.createdBy.authorization).toMatchObject({
      kind: "proposal_approval",
      proposalId: proposal.id,
    });
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
});
