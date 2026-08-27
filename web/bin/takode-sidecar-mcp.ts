#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { COMPANION_AUTH_TOKEN_HEADER, COMPANION_SESSION_ID_HEADER } from "../server/routes/auth.js";
import {
  bindTakodeCodexActor,
  resolveTakodeSidecarConnection,
  takodeSidecarPort,
  type SidecarEnvironment,
} from "./takode-sidecar-client.js";

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

const todoStatusSchema = z.enum(["todo", "doing", "done"]);

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

type RequestEnvironment = SidecarEnvironment;

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

  const connection = await resolveTakodeSidecarConnection(environment);
  if (!connection) {
    const port = takodeSidecarPort(environment);
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
      let bindingId: string;
      try {
        bindingId = await bindTakodeCodexActor(connection, identity.actor);
      } catch (error) {
        return toolResponse(
          {
            error: error instanceof Error ? error.message : String(error),
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

/** Register the focused non-Quest Takode data tools exposed to Codex tasks. */
export function registerTakodeSidecarTools(server: Pick<McpServer, "registerTool">): void {
  registerTodoTools(server);
  registerMemoryAndLeaseTools(server);
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
