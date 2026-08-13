import { Hono, type Context } from "hono";
import type {
  TodoCompactItem,
  TodoGrantAction,
  TodoItem,
  TodoItemListFilters,
  TodoState,
  TodoProposalMutation,
  TodoStatus,
} from "../../shared/todo-types.js";
import { TODO_STATUSES } from "../../shared/todo-types.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import * as cronStore from "../cron-store.js";
import { authorizeTodoMutation, todoProposalActor } from "../todo-authorization.js";
import { TODO_INBOX_CATEGORY_ID, TodoStoreError, todoStore, type TodoStore } from "../todo-store.js";
import type { RouteContext } from "./context.js";

function errorStatus(error: TodoStoreError): 400 | 404 | 409 | 503 {
  switch (error.code) {
    case "invalid":
      return 400;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "corrupt_store":
    case "unsupported_schema":
      return 503;
  }
}

function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof TodoStoreError) return c.json({ error: error.message, code: error.code }, errorStatus(error));
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ error: message }, 500);
}

function compactItem(item: TodoItem, state: TodoState): TodoCompactItem {
  return {
    id: item.id,
    titleMarkdown: deriveTodoMarkdown(item.markdown).titleMarkdown,
    categoryId: item.categoryId,
    categoryName: state.categories.find((category) => category.id === item.categoryId)?.name ?? item.categoryId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    statusChangedAt: item.statusChangedAt,
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
    ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
  };
}

function parseCsv(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries?.length ? entries : undefined;
}

function parseStatuses(value: string | undefined): TodoStatus[] | undefined {
  const entries = parseCsv(value);
  if (!entries) return undefined;
  for (const entry of entries) {
    if (!TODO_STATUSES.includes(entry as TodoStatus)) {
      throw new TodoStoreError(`Unsupported status: ${entry}`, "invalid");
    }
  }
  return entries as TodoStatus[];
}

async function requestBody(c: Context): Promise<Record<string, any>> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TodoStoreError("Request body must be an object", "invalid");
    }
    return value;
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    throw new TodoStoreError("Request body must be valid JSON", "invalid");
  }
}

async function broadcastTodoState(ctx: RouteContext, store: TodoStore): Promise<void> {
  const state = await store.snapshot();
  ctx.wsBridge.broadcastGlobal({ type: "todo_state_updated", revision: state.revision, updatedAt: state.updatedAt });
}

async function withMutation<T>(
  c: Context,
  ctx: RouteContext,
  store: TodoStore,
  mutate: () => Promise<T>,
  status: 200 | 201 = 200,
): Promise<Response> {
  try {
    const result = await mutate();
    await broadcastTodoState(ctx, store);
    const state = await store.snapshot();
    return c.json({ state, ...(result && typeof result === "object" ? result : {}) }, status);
  } catch (error) {
    return errorResponse(c, error);
  }
}

async function authorize(
  c: Context,
  ctx: RouteContext,
  store: TodoStore,
  body: Record<string, any>,
  action: TodoGrantAction,
  categoryIds: string[],
  allowGrant = true,
) {
  return authorizeTodoMutation(c, ctx, store, {
    action,
    categoryIds,
    authorizedBy: body.authorizedBy,
    allowGrant,
  });
}

export function createTodoRoutes(ctx: RouteContext, store: TodoStore = todoStore) {
  const api = new Hono();

  api.get("/todos", async (c) => {
    try {
      return c.json(await store.snapshot());
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/principals", async (c) => {
    const sessions = ctx.launcher
      .listSessions()
      .filter((session) => !session.archived && !session.hidden)
      .map((session) => ({
        kind: "session" as const,
        id: session.sessionId,
        label: `${session.sessionNum != null ? `#${session.sessionNum} ` : ""}${session.name || session.sessionId.slice(0, 8)}`,
      }));
    const jobs = (await cronStore.listJobs()).map((job) => ({ kind: "cron" as const, id: job.id, label: job.name }));
    return c.json({ principals: [...jobs, ...sessions] });
  });

  api.get("/todos/categories", async (c) => {
    try {
      const state = await store.snapshot();
      return c.json({
        categories: state.categories.map((category) => ({
          ...category,
          activeItemCount: state.items.filter((item) => !item.archivedAt && item.categoryId === category.id).length,
        })),
        revision: state.revision,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/proposals", async (c) => {
    try {
      const state = await store.snapshot();
      const requestedStatus = c.req.query("status");
      return c.json({
        proposals: requestedStatus
          ? state.proposals.filter((proposal) => proposal.status === requestedStatus)
          : state.proposals,
        revision: state.revision,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/proposals/:id", async (c) => {
    try {
      const state = await store.snapshot();
      const proposal = state.proposals.find((candidate) => candidate.id === c.req.param("id"));
      if (!proposal) throw new TodoStoreError(`Proposal not found: ${c.req.param("id")}`, "not_found");
      return c.json({ proposal });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/grants", async (c) => {
    try {
      const state = await store.snapshot();
      const includeRevoked = c.req.query("includeRevoked") === "true";
      return c.json({
        grants: state.grants.filter((grant) => includeRevoked || !grant.revokedAt),
        revision: state.revision,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/grants/:id", async (c) => {
    try {
      const state = await store.snapshot();
      const grant = state.grants.find((candidate) => candidate.id === c.req.param("id"));
      if (!grant) throw new TodoStoreError(`Grant not found: ${c.req.param("id")}`, "not_found");
      return c.json({ grant });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/items", async (c) => {
    try {
      const filters: TodoItemListFilters = {
        statuses: parseStatuses(c.req.query("status")),
        categoryIds: parseCsv(c.req.query("category")),
        search: c.req.query("search"),
        includeArchived: c.req.query("includeArchived") === "true",
        completedOn: c.req.query("completedOn"),
        timeZone: c.req.query("timeZone"),
      };
      const state = await store.snapshot();
      const items = await store.listItems(filters);
      return c.json({ items: items.map((item) => compactItem(item, state)), revision: state.revision });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/find", async (c) => {
    try {
      const link = c.req.query("link") || "";
      const state = await store.snapshot();
      const items = await store.findItemsByLink(link, c.req.query("includeArchived") === "true");
      return c.json({ items: items.map((item) => compactItem(item, state)), revision: state.revision });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/items/:id", async (c) => {
    try {
      const item = await store.getItem(c.req.param("id"));
      const state = await store.snapshot();
      return c.json({ item, category: state.categories.find((category) => category.id === item.categoryId) ?? null });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items", async (c) => {
    try {
      const body = await requestBody(c);
      const referenceId =
        typeof body.beforeItemId === "string" && body.beforeItemId.trim()
          ? body.beforeItemId.trim()
          : typeof body.afterItemId === "string" && body.afterItemId.trim()
            ? body.afterItemId.trim()
            : "";
      const reference = referenceId ? await store.getItem(referenceId) : null;
      const categoryId =
        typeof body.categoryId === "string" && body.categoryId.trim()
          ? body.categoryId.trim()
          : (reference?.categoryId ?? TODO_INBOX_CATEGORY_ID);
      const auth = await authorize(c, ctx, store, body, "item:add", [categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(
        c,
        ctx,
        store,
        async () => ({
          item: await store.createItem(
            {
              markdown: body.markdown,
              titleMarkdown: body.titleMarkdown,
              ...(Object.prototype.hasOwnProperty.call(body, "detailsMarkdown")
                ? { detailsMarkdown: body.detailsMarkdown }
                : {}),
              categoryId,
              status: body.status,
              beforeItemId: body.beforeItemId,
              afterItemId: body.afterItemId,
            },
            auth.provenance,
          ),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.patch("/todos/items/:id", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const auth = await authorize(c, ctx, store, body, "item:edit", [item.categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.editItem(
          item.id,
          {
            markdown: body.markdown,
            titleMarkdown: body.titleMarkdown,
            ...(Object.prototype.hasOwnProperty.call(body, "detailsMarkdown")
              ? { detailsMarkdown: body.detailsMarkdown }
              : {}),
          },
          auth.provenance,
        ),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/status", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const auth = await authorize(c, ctx, store, body, "item:status", [item.categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.setItemStatus(item.id, body.status, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/move", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const referenceId =
        typeof body.beforeItemId === "string" && body.beforeItemId.trim()
          ? body.beforeItemId.trim()
          : typeof body.afterItemId === "string" && body.afterItemId.trim()
            ? body.afterItemId.trim()
            : "";
      const reference = referenceId ? await store.getItem(referenceId) : null;
      const categoryId =
        typeof body.categoryId === "string" && body.categoryId.trim()
          ? body.categoryId.trim()
          : (reference?.categoryId ?? item.categoryId);
      const auth = await authorize(c, ctx, store, body, "item:move", [item.categoryId, categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.moveItem(
          item.id,
          { categoryId, beforeItemId: body.beforeItemId, afterItemId: body.afterItemId },
          auth.provenance,
        ),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  for (const [path, archived, action] of [
    ["archive", true, "item:archive"],
    ["restore", false, "item:restore"],
  ] as const) {
    api.post(`/todos/items/:id/${path}`, async (c) => {
      try {
        const body = await requestBody(c);
        const item = await store.getItem(c.req.param("id"));
        const auth = await authorize(c, ctx, store, body, action, [item.categoryId]);
        if (!auth.ok) return auth.response;
        return withMutation(c, ctx, store, async () => ({
          item: await store.setItemArchived(item.id, archived, auth.provenance),
        }));
      } catch (error) {
        return errorResponse(c, error);
      }
    });
  }

  api.post("/todos/categories", async (c) => {
    try {
      const body = await requestBody(c);
      const auth = await authorize(c, ctx, store, body, "category:create", []);
      if (!auth.ok) return auth.response;
      return withMutation(
        c,
        ctx,
        store,
        async () => ({
          category: await store.createCategory({ name: body.name }, auth.provenance),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.patch("/todos/categories/:id", async (c) => {
    try {
      const body = await requestBody(c);
      const categoryId = c.req.param("id");
      const auth = await authorize(c, ctx, store, body, "category:rename", [categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.renameCategory(categoryId, body.name, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/categories/:id/archive", async (c) => {
    try {
      const body = await requestBody(c);
      const categoryId = c.req.param("id");
      const auth = await authorize(c, ctx, store, body, "category:archive", [categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.archiveCategory(categoryId, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/categories/:id/restore", async (c) => {
    try {
      const body = await requestBody(c);
      const categoryId = c.req.param("id");
      const auth = await authorize(c, ctx, store, body, "category:restore", [categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.restoreCategory(categoryId, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/proposals", async (c) => {
    try {
      const auth = ctx.authenticateTakodeCaller(c);
      if ("response" in auth) return auth.response;
      const body = await requestBody(c);
      const proposal = await store.createProposal(body.mutation as TodoProposalMutation, todoProposalActor(auth));
      await broadcastTodoState(ctx, store);
      return c.json({ proposal, state: await store.snapshot() }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  for (const decision of ["approved", "rejected"] as const) {
    api.post(`/todos/proposals/:id/${decision === "approved" ? "approve" : "reject"}`, async (c) => {
      try {
        const body = await requestBody(c);
        const auth = await authorize(c, ctx, store, body, "item:edit", [], false);
        if (!auth.ok) return auth.response;
        return withMutation(c, ctx, store, async () =>
          store.resolveProposal(c.req.param("id"), decision, auth.provenance),
        );
      } catch (error) {
        return errorResponse(c, error);
      }
    });
  }

  api.post("/todos/grants", async (c) => {
    try {
      const body = await requestBody(c);
      const auth = await authorize(c, ctx, store, body, "item:edit", [], false);
      if (!auth.ok) return auth.response;
      return withMutation(
        c,
        ctx,
        store,
        async () => ({
          grant: await store.createGrant(
            { principal: body.principal, actions: body.actions, categoryIds: body.categoryIds },
            auth.provenance,
          ),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/grants/:id/revoke", async (c) => {
    try {
      const body = await requestBody(c);
      const auth = await authorize(c, ctx, store, body, "item:edit", [], false);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        grant: await store.revokeGrant(c.req.param("id"), auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return api;
}
