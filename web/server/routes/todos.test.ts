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
    launcher: {
      listSessions: () => [],
    },
    wsBridge: {
      getSession: () => bridgeSession,
      broadcastGlobal,
    },
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
  it("treats direct browser UI mutations as authorized server-side state changes", async () => {
    const response = await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "[Review result](quest:q-42)",
      status: "doing",
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.item).toMatchObject({ id: "td-1", status: "doing" });
    expect(body.item.createdBy.authorization.kind).toBe("ui");
    expect(broadcastGlobal).toHaveBeenCalledWith(expect.objectContaining({ type: "todo_state_updated", revision: 1 }));
  });

  it("fails closed for an agent mutation without a direct user message or matching grant", async () => {
    optionalCaller = caller();

    const response = await jsonRequest("/todos/items", "POST", { titleMarkdown: "Unapproved reminder" });
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

    const rejected = await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "Injected",
      authorizedBy: 1,
    });
    expect(rejected.status).toBe(403);

    const accepted = await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "Review the result",
      authorizedBy: 0,
    });
    expect(accepted.status).toBe(201);
    const body = await accepted.json();
    expect(body.item.createdBy.authorization).toMatchObject({
      kind: "direct_message",
      userMessage: { sessionId: "session-1", historyIndex: 0, messageId: "human-1" },
    });
  });

  it("uses the authenticated cronJobId as a trustworthy scoped workflow principal", async () => {
    const categoryResponse = await jsonRequest("/todos/categories", "POST", { name: "Slack" });
    const category = (await categoryResponse.json()).category;
    const grantResponse = await jsonRequest("/todos/grants", "POST", {
      principal: { kind: "cron", id: "slack-sweep", label: "Slack sweep" },
      actions: ["item:add"],
      categoryIds: [category.id],
    });
    expect(grantResponse.status).toBe(201);

    optionalCaller = caller({ cronJobId: "slack-sweep", cronJobName: "Slack sweep" });
    const accepted = await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "[Reply to thread](https://example.slack.com/thread)",
      categoryId: category.id,
    });
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).item.createdBy).toMatchObject({
      actor: { kind: "workflow", workflowId: "slack-sweep" },
      authorization: { kind: "grant", grantId: "tg-1" },
    });

    const denied = await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "Out of scope",
      categoryId: "cat-inbox",
    });
    expect(denied.status).toBe(403);
  });

  it("lets agents create proposals without mutating the real list until user approval", async () => {
    requiredCaller = caller();
    const proposed = await jsonRequest("/todos/proposals", "POST", {
      mutation: { action: "item:add", input: { titleMarkdown: "Read the important result" } },
    });
    expect(proposed.status).toBe(201);
    const proposal = (await proposed.json()).proposal;
    expect((await store.snapshot()).items).toEqual([]);

    optionalCaller = null;
    const approved = await jsonRequest(`/todos/proposals/${proposal.id}/approve`, "POST", {});
    expect(approved.status).toBe(200);
    const body = await approved.json();
    expect(body.item.titleMarkdown).toBe("Read the important result");
    expect(body.item.createdBy.authorization).toMatchObject({
      kind: "proposal_approval",
      proposalId: proposal.id,
    });
  });

  it("keeps category archival reversible and refuses silent item loss", async () => {
    const category = (await (await jsonRequest("/todos/categories", "POST", { name: "Results" })).json()).category;
    const item = (
      await (await jsonRequest("/todos/items", "POST", { titleMarkdown: "Review", categoryId: category.id })).json()
    ).item;

    const blocked = await jsonRequest(`/todos/categories/${category.id}/archive`, "POST", {});
    expect(blocked.status).toBe(409);

    expect((await jsonRequest(`/todos/items/${item.id}/archive`, "POST", {})).status).toBe(200);
    expect((await jsonRequest(`/todos/categories/${category.id}/archive`, "POST", {})).status).toBe(200);
    expect((await jsonRequest(`/todos/items/${item.id}/restore`, "POST", {})).status).toBe(409);
    expect((await jsonRequest(`/todos/categories/${category.id}/restore`, "POST", {})).status).toBe(200);
    expect((await jsonRequest(`/todos/items/${item.id}/restore`, "POST", {})).status).toBe(200);
  });

  it("keeps repeated list/find payloads compact and reserves full Markdown provenance for show", async () => {
    await jsonRequest("/todos/items", "POST", {
      titleMarkdown: "[Reply](https://example.com/thread)",
      detailsMarkdown: "Long private details",
    });

    const listBody = await (await jsonRequest("/todos/items")).json();
    expect(listBody.items[0]).toMatchObject({ id: "td-1", categoryName: "Inbox" });
    expect(listBody.items[0].detailsMarkdown).toBeUndefined();
    expect(listBody.items[0].lastModifiedBy).toBeUndefined();
    expect(listBody.state).toBeUndefined();

    const findBody = await (await jsonRequest("/todos/find?link=https%3A%2F%2Fexample.com%2Fthread")).json();
    expect(findBody.items[0].detailsMarkdown).toBeUndefined();

    const showBody = await (await jsonRequest("/todos/items/td-1")).json();
    expect(showBody.item.detailsMarkdown).toBe("Long private details");
    expect(showBody.item.lastModifiedBy.authorization.kind).toBe("ui");
  });
});
