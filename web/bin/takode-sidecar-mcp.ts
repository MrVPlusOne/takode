#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { COMPANION_AUTH_TOKEN_HEADER, COMPANION_SESSION_ID_HEADER } from "../server/routes/auth.js";

const API_PREFIX = "/api/integrations/codex";
const SIDECAR_CAPABILITY_HEADER = "x-takode-sidecar-capability";
const SIDECAR_BINDING_HEADER = "x-takode-sidecar-binding";

const contextSchema = z
  .object({
    runtime: z.literal("codex"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1).optional(),
    toolUseId: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
  })
  .optional()
  .describe("Injected by the Takode plugin hook; callers should omit this field.");

const questIdSchema = z.string().regex(/^q-\d+$/, "Expected a Takode quest id such as q-123");
const todoStatusSchema = z.enum(["todo", "doing", "done"]);
const feedbackKindSchema = z.enum(["comment", "artifact", "system"]);

export interface CodexToolContext {
  runtime: "codex";
  sessionId: string;
  turnId?: string;
  toolUseId?: string;
  cwd?: string;
}

export type SidecarActor = {
  kind: "takode_session" | "codex_session";
  sessionId: string;
  turnId?: string;
  toolUseId?: string;
  cwd?: string;
};

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type RequestEnvironment = Record<string, string | undefined>;

interface IntegrationRequest {
  method?: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  context?: CodexToolContext;
  requireIdentity?: boolean;
  environment?: RequestEnvironment;
}

interface ResolvedIdentity {
  actor: SidecarActor;
  headers: Record<string, string>;
}

interface SidecarConnection {
  baseUrl: string;
  capability: string;
}

function resolveIdentity(
  context: CodexToolContext | undefined,
  environment: RequestEnvironment,
): ResolvedIdentity | null {
  const companionSessionId = environment.COMPANION_SESSION_ID?.trim();
  const companionAuthToken = environment.COMPANION_AUTH_TOKEN?.trim();
  if (companionSessionId && companionAuthToken) {
    return {
      actor: { kind: "takode_session", sessionId: companionSessionId },
      headers: {
        [COMPANION_SESSION_ID_HEADER]: companionSessionId,
        [COMPANION_AUTH_TOKEN_HEADER]: companionAuthToken,
      },
    };
  }

  if (!context?.sessionId.trim()) return null;
  return {
    actor: {
      kind: "codex_session",
      sessionId: context.sessionId.trim(),
      ...(context.turnId ? { turnId: context.turnId } : {}),
      ...(context.toolUseId ? { toolUseId: context.toolUseId } : {}),
      ...(context.cwd ? { cwd: context.cwd } : {}),
    },
    headers: {},
  };
}

function apiPort(environment: RequestEnvironment): number {
  const hasManagedIdentity = !!environment.COMPANION_SESSION_ID?.trim() && !!environment.COMPANION_AUTH_TOKEN?.trim();
  const candidates = hasManagedIdentity
    ? [environment.COMPANION_PORT, environment.TAKODE_API_PORT]
    : [environment.TAKODE_API_PORT, environment.COMPANION_PORT];
  for (const raw of candidates) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) return parsed;
  }
  return 3456;
}

async function resolveSidecarConnection(environment: RequestEnvironment): Promise<SidecarConnection | null> {
  const port = apiPort(environment);
  const home = environment.HOME?.trim() || homedir();
  const capabilityPath = join(home, ".companion", "integrations", `codex-sidecar-${port}.json`);
  try {
    const parsed = JSON.parse(await readFile(capabilityPath, "utf-8")) as {
      version?: unknown;
      baseUrl?: unknown;
      capability?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.baseUrl !== "string" || typeof parsed.capability !== "string") {
      return null;
    }
    const baseUrl = new URL(parsed.baseUrl);
    if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(baseUrl.hostname)) return null;
    if (!parsed.capability.trim()) return null;
    return { baseUrl: baseUrl.toString().replace(/\/$/, ""), capability: parsed.capability.trim() };
  } catch {
    return null;
  }
}

function responseText(value: unknown): string {
  if (value && typeof value === "object") {
    const message = (value as { error?: unknown; message?: unknown }).error ?? (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return JSON.stringify(value);
}

function toolResponse(value: unknown, isError = false): ToolResponse {
  const structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  return {
    content: [{ type: "text", text: responseText(value) }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

/** Call the additive Codex integration API and return an MCP-compatible result. */
export async function callTakodeIntegration(request: IntegrationRequest): Promise<ToolResponse> {
  const environment = request.environment ?? process.env;
  const identity = resolveIdentity(request.context, environment);
  if (request.requireIdentity && !identity) {
    return toolResponse(
      {
        error: "Takode write identity is unavailable. Trust the Takode plugin hook, then retry from a new Codex task.",
      },
      true,
    );
  }

  const connection = await resolveSidecarConnection(environment);
  if (!connection) {
    const port = apiPort(environment);
    return toolResponse(
      {
        error:
          `Takode sidecar capability is unavailable for port ${port}. ` +
          "Start or update the Takode server, then retry from a new Codex task.",
      },
      true,
    );
  }

  const url = new URL(`${connection.baseUrl}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    ...(identity?.headers ?? {}),
    [SIDECAR_CAPABILITY_HEADER]: connection.capability,
  };

  const body = request.body
    ? {
        ...request.body,
        ...(identity ? { actor: identity.actor } : {}),
      }
    : request.requireIdentity && identity
      ? { actor: identity.actor }
      : undefined;
  if (body) headers["content-type"] = "application/json";

  try {
    if (request.requireIdentity && identity?.actor.kind === "codex_session") {
      const bindingResponse = await fetch(new URL(`${connection.baseUrl}/bind`), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIDECAR_CAPABILITY_HEADER]: connection.capability,
        },
        body: JSON.stringify({ actor: identity.actor }),
      });
      const bindingBody = (await bindingResponse.json().catch(() => ({}))) as {
        binding?: { id?: unknown };
        error?: unknown;
      };
      const bindingId = bindingBody.binding?.id;
      if (!bindingResponse.ok || typeof bindingId !== "string" || !bindingId) {
        return toolResponse(
          {
            error:
              typeof bindingBody.error === "string"
                ? bindingBody.error
                : `Takode identity binding failed with HTTP ${bindingResponse.status}`,
          },
          true,
        );
      }
      headers[SIDECAR_BINDING_HEADER] = bindingId;
    }

    const response = await fetch(url, {
      method: request.method ?? "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json().catch(() => ({ error: `Takode returned HTTP ${response.status}` }));
    return toolResponse(value, !response.ok);
  } catch (error) {
    return toolResponse(
      {
        error: `Unable to reach the Takode sidecar at ${url.origin}: ${error instanceof Error ? error.message : String(error)}`,
      },
      true,
    );
  }
}

/** Register the focused Takode data tools exposed to Codex tasks. */
export function registerTakodeSidecarTools(server: Pick<McpServer, "registerTool">): void {
  server.registerTool(
    "quest_search",
    {
      title: "Search Takode quests",
      description: "Find compact Takode quest records by text. An empty query lists recent records.",
      inputSchema: {
        query: z.string().default(""),
        limit: z.number().int().min(1).max(50).default(20),
        _takodeContext: contextSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, _takodeContext }) =>
      callTakodeIntegration({ path: "/quests/search", query: { q: query, limit }, context: _takodeContext }),
  );

  server.registerTool(
    "quest_show",
    {
      title: "Show Takode quest",
      description:
        "Read one compact Takode quest record. Set noteLimit to reveal a bounded page of full durable notes.",
      inputSchema: {
        questId: questIdSchema,
        noteOffset: z.number().int().min(0).optional(),
        noteLimit: z.number().int().min(1).max(20).optional(),
        _takodeContext: contextSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ questId, noteOffset, noteLimit, _takodeContext }) =>
      callTakodeIntegration({
        path: `/quests/${encodeURIComponent(questId)}`,
        query: { noteOffset, noteLimit },
        context: _takodeContext,
      }),
  );

  server.registerTool(
    "quest_create",
    {
      title: "Create Takode quest",
      description: "Create a documentation-focused Takode quest record.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().min(1).optional(),
        tldr: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).optional(),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ _takodeContext, ...body }) =>
      callTakodeIntegration({ method: "POST", path: "/quests", body, context: _takodeContext, requireIdentity: true }),
  );

  server.registerTool(
    "quest_edit",
    {
      title: "Edit Takode quest",
      description: "Edit quest content without changing its lifecycle state.",
      inputSchema: {
        questId: questIdSchema,
        title: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        tldr: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).optional(),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ questId, _takodeContext, ...body }) =>
      callTakodeIntegration({
        method: "PATCH",
        path: `/quests/${encodeURIComponent(questId)}`,
        body,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );

  server.registerTool(
    "quest_add_note",
    {
      title: "Add Takode quest note",
      description: "Append a durable decision, outcome, artifact, or handoff note to a quest.",
      inputSchema: {
        questId: questIdSchema,
        text: z.string().min(1),
        tldr: z.string().min(1).optional(),
        kind: feedbackKindSchema.default("comment"),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ questId, _takodeContext, ...body }) =>
      callTakodeIntegration({
        method: "POST",
        path: `/quests/${encodeURIComponent(questId)}/notes`,
        body,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );

  registerQuestLifecycleTools(server);
  registerTodoTools(server);
  registerMemoryAndLeaseTools(server);
}

function registerQuestLifecycleTools(server: Pick<McpServer, "registerTool">): void {
  server.registerTool(
    "quest_claim",
    {
      title: "Claim Takode quest",
      description: "Associate the current Codex or Takode session with a quest record.",
      inputSchema: { questId: questIdSchema, _takodeContext: contextSchema },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ questId, _takodeContext }) =>
      callTakodeIntegration({
        method: "POST",
        path: `/quests/${encodeURIComponent(questId)}/claim`,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );

  server.registerTool(
    "quest_complete",
    {
      title: "Complete Takode quest",
      description: "Mark a quest complete with a required final debrief and concise debrief TLDR.",
      inputSchema: {
        questId: questIdSchema,
        debrief: z.string().min(1),
        debriefTldr: z.string().min(1),
        notes: z.string().min(1).optional(),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ questId, _takodeContext, ...body }) =>
      callTakodeIntegration({
        method: "POST",
        path: `/quests/${encodeURIComponent(questId)}/complete`,
        body,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );

  server.registerTool(
    "quest_cancel",
    {
      title: "Cancel Takode quest",
      description: "Cancel a quest and optionally record why it will not be completed.",
      inputSchema: {
        questId: questIdSchema,
        notes: z.string().min(1).optional(),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ questId, _takodeContext, ...body }) =>
      callTakodeIntegration({
        method: "POST",
        path: `/quests/${encodeURIComponent(questId)}/cancel`,
        body,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );
}

function registerTodoTools(server: Pick<McpServer, "registerTool">): void {
  server.registerTool(
    "todo_list",
    {
      title: "List Takode to-dos",
      description: "List compact personal Takode to-dos with optional filters.",
      inputSchema: {
        status: todoStatusSchema.optional(),
        category: z.string().min(1).optional(),
        search: z.string().min(1).optional(),
        includeArchived: z.boolean().default(false),
        _takodeContext: contextSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ status, category, search, includeArchived, _takodeContext }) =>
      callTakodeIntegration({
        path: "/todos",
        query: { status, category, search, includeArchived },
        context: _takodeContext,
      }),
  );

  server.registerTool(
    "todo_show",
    {
      title: "Show Takode to-do",
      description: "Read one personal Takode to-do with its full Markdown.",
      inputSchema: { todoId: z.string().min(1), _takodeContext: contextSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ todoId, _takodeContext }) =>
      callTakodeIntegration({ path: `/todos/${encodeURIComponent(todoId)}`, context: _takodeContext }),
  );

  server.registerTool(
    "todo_create",
    {
      title: "Create Takode to-do",
      description: "Create a durable personal Takode to-do from Markdown.",
      inputSchema: {
        markdown: z.string().min(1),
        categoryId: z.string().min(1).optional(),
        status: todoStatusSchema.optional(),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ _takodeContext, ...body }) =>
      callTakodeIntegration({ method: "POST", path: "/todos", body, context: _takodeContext, requireIdentity: true }),
  );

  server.registerTool(
    "todo_edit",
    {
      title: "Edit Takode to-do",
      description: "Replace the authored Markdown of a personal Takode to-do.",
      inputSchema: {
        todoId: z.string().min(1),
        markdown: z.string().min(1),
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ todoId, _takodeContext, ...body }) =>
      callTakodeIntegration({
        method: "PATCH",
        path: `/todos/${encodeURIComponent(todoId)}`,
        body,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );

  server.registerTool(
    "todo_set_status",
    {
      title: "Set Takode to-do status",
      description: "Move a personal Takode to-do between todo, doing, and done.",
      inputSchema: {
        todoId: z.string().min(1),
        status: todoStatusSchema,
        _takodeContext: contextSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ todoId, _takodeContext, ...body }) =>
      callTakodeIntegration({
        method: "POST",
        path: `/todos/${encodeURIComponent(todoId)}/status`,
        body,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );

  server.registerTool(
    "todo_archive",
    {
      title: "Archive Takode to-do",
      description: "Archive a personal Takode to-do without deleting it.",
      inputSchema: { todoId: z.string().min(1), _takodeContext: contextSchema },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ todoId, _takodeContext }) =>
      callTakodeIntegration({
        method: "POST",
        path: `/todos/${encodeURIComponent(todoId)}/archive`,
        context: _takodeContext,
        requireIdentity: true,
      }),
  );
}

function registerMemoryAndLeaseTools(server: Pick<McpServer, "registerTool">): void {
  server.registerTool(
    "memory_recall",
    {
      title: "Recall Takode memory",
      description: "Search curated Takode workstream memory for relevant records.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(10),
        _takodeContext: contextSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, _takodeContext }) =>
      callTakodeIntegration({ path: "/memory/recall", query: { q: query, limit }, context: _takodeContext }),
  );

  server.registerTool(
    "memory_read",
    {
      title: "Read Takode memory",
      description: "Read one curated Takode memory file returned by memory_recall.",
      inputSchema: { path: z.string().min(1), _takodeContext: contextSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path, _takodeContext }) =>
      callTakodeIntegration({ path: "/memory/read", query: { path }, context: _takodeContext }),
  );

  server.registerTool(
    "lease_status",
    {
      title: "Show Takode lease status",
      description: "Read the current holder and expiry of one shared-resource lease.",
      inputSchema: { resourceKey: z.string().min(1), _takodeContext: contextSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ resourceKey, _takodeContext }) =>
      callTakodeIntegration({ path: `/leases/${encodeURIComponent(resourceKey)}`, context: _takodeContext }),
  );
}

/** Start the Takode sidecar MCP server on stdio. */
export async function runTakodeSidecarMcpServer(): Promise<void> {
  const server = new McpServer({ name: "takode", version: "0.1.0" });
  registerTakodeSidecarTools(server);
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await runTakodeSidecarMcpServer();
}
