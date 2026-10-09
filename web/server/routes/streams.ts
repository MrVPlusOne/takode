import { Hono } from "hono";
import { getServerId } from "../settings-manager.js";
import type { StreamEntryType, StreamRecord } from "../stream-types.js";
import type { StreamServerCommandRequest } from "../../shared/stream-command-transport.js";
import * as treeGroupStore from "../tree-group-store.js";
import type { RouteContext } from "./context.js";

const RISK_ENTRY_TYPES = new Set<StreamEntryType>(["alert", "contradiction"]);

function truthyQuery(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function countEntries(streams: StreamRecord[], type: StreamEntryType): number {
  return streams.reduce((total, stream) => total + stream.timeline.filter((entry) => entry.type === type).length, 0);
}

function countRiskStreams(streams: StreamRecord[]): number {
  return streams.filter(
    (stream) =>
      stream.status === "blocked" ||
      stream.current.blockedOn ||
      stream.current.knownStaleFacts?.length ||
      stream.pinnedFacts?.some((fact) => fact.status !== "active") ||
      stream.timeline.some((entry) => RISK_ENTRY_TYPES.has(entry.type)),
  ).length;
}

export function createStreamRoutes(ctx: RouteContext) {
  const api = new Hono();

  api.get("/streams/groups", async (c) => {
    const includeArchived = truthyQuery(c.req.query("includeArchived"));
    const query = c.req.query("q")?.trim() || undefined;
    const serverId = getServerId();
    const treeGroups = await treeGroupStore.getState();
    const { listStreams, streamScopeForSessionGroup } = await import("../stream-store.js");

    const groups = await Promise.all(
      treeGroups.groups.map(async (group) => {
        const scope = streamScopeForSessionGroup(group.id, serverId);
        const streams = await listStreams({
          scope,
          includeArchived,
          ...(query ? { text: query } : {}),
        });
        return {
          group,
          scope,
          streams,
          counts: {
            total: streams.length,
            active: streams.filter((stream) => stream.status !== "archived").length,
            archived: streams.filter((stream) => stream.status === "archived").length,
            blocked: streams.filter((stream) => stream.status === "blocked").length,
            risk: countRiskStreams(streams),
            alerts: countEntries(streams, "alert"),
            contradictions: countEntries(streams, "contradiction"),
            handoffs: countEntries(streams, "handoff"),
          },
        };
      }),
    );

    return c.json({
      serverId,
      includeArchived,
      query: query ?? "",
      groups,
    });
  });

  api.get("/streams/:ref", async (c) => {
    const scope = c.req.query("scope")?.trim();
    if (!scope) return c.json({ error: "scope query parameter is required" }, 400);
    const ref = c.req.param("ref");
    const { getStreamDashboard } = await import("../stream-store.js");
    const dashboard = await getStreamDashboard(ref, scope);
    if (!dashboard) return c.json({ error: "Stream not found" }, 404);
    return c.json({
      scope,
      stream: dashboard.stream,
      children: dashboard.children,
    });
  });

  // The server is the only writer of stream data: the `stream` CLI sends its
  // commands here, so a CLI on a remote host never keeps a copy of its own.
  api.post("/streams/command", async (c) => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth && "response" in auth) return auth.response;
    const request = parseStreamCommandRequest(await c.req.json().catch(() => null));
    if (!request) return c.json({ error: "Expected { args: string[], context: object }" }, 400);
    const { runStreamCommand } = await import("../stream-command.js");
    const { context, files } = request;
    const sessionId = auth ? auth.callerId : context.sessionId;
    const result = await runStreamCommand(request.args, {
      ...(sessionId ? { sessionId } : {}),
      serverId: context.serverId || getServerId(),
      ...(context.projectScope ? { projectScope: context.projectScope } : {}),
      readTextFile: async (path) => {
        const content = files?.[path];
        if (typeof content !== "string") throw new Error(`File was not sent with the command: ${path}`);
        return content;
      },
    });
    return c.json(result);
  });

  return api;
}

function parseStreamCommandRequest(body: unknown): StreamServerCommandRequest | null {
  if (!body || typeof body !== "object") return null;
  const { args, context, files } = body as Record<string, unknown>;
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return null;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const raw = context as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  const validFiles =
    files && typeof files === "object" && !Array.isArray(files)
      ? Object.fromEntries(Object.entries(files).filter(([, value]) => typeof value === "string"))
      : undefined;
  return {
    args,
    context: {
      ...(text(raw.sessionId) ? { sessionId: text(raw.sessionId) } : {}),
      ...(text(raw.serverId) ? { serverId: text(raw.serverId) } : {}),
      ...(text(raw.projectScope) ? { projectScope: text(raw.projectScope) } : {}),
    },
    ...(validFiles ? { files: validFiles as Record<string, string> } : {}),
  };
}
