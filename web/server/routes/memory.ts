import { Hono } from "hono";
import type { MemoryLintIssue } from "../workstream-memory-types.js";
import { memorySessionSpaceSlugsForTreeGroups } from "../session-memory-space.js";
import * as treeGroupStore from "../tree-group-store.js";
import type { RouteContext } from "./context.js";
import { getServerId, getServerSlug } from "../settings-manager.js";
import type { MemoryServerCommandRequest } from "../../shared/memory-command-transport.js";

interface MemoryIssueCounts {
  errors: number;
  warnings: number;
}

interface MemoryGitStatusEntry {
  code: string;
  path: string;
  raw: string;
}

function issueCounts(issues: MemoryLintIssue[]): MemoryIssueCounts {
  return issues.reduce(
    (counts, issue) => ({
      errors: counts.errors + (issue.severity === "error" ? 1 : 0),
      warnings: counts.warnings + (issue.severity === "warning" ? 1 : 0),
    }),
    { errors: 0, warnings: 0 },
  );
}

function issuesForPath(issues: MemoryLintIssue[], path: string): MemoryLintIssue[] {
  return issues.filter((issue) => issue.path === path || issue.id === path);
}

function parseGitStatus(status: string): MemoryGitStatusEntry[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim() || "?",
      path: line.slice(3).trim() || line,
      raw: line,
    }));
}

function parseRecentLimit(value: string | undefined): number {
  if (!value) return 20;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 100);
}

async function expectedSessionSpaceSlugs(ctx: RouteContext): Promise<string[]> {
  return memorySessionSpaceSlugsForTreeGroups(
    await treeGroupStore.getState(),
    ctx.launcher.getMemorySessionSpaceSlug(),
  );
}

async function resolveMemorySpaceOptions(
  ctx: RouteContext,
  c: { req: { query: (name: string) => string | undefined } },
) {
  const { workstreamMemoryService } = await import("../workstream-memory-service.js");
  return workstreamMemoryService.resolveSpaceOptions({
    serverSlug: c.req.query("serverSlug"),
    root: c.req.query("root"),
    expectedSessionSpaceSlugs: await expectedSessionSpaceSlugs(ctx),
  });
}

export function createMemoryRoutes(ctx: RouteContext) {
  const api = new Hono();

  api.get("/memory/spaces", async (c) => {
    const { workstreamMemoryService } = await import("../workstream-memory-service.js");
    const spaces = await workstreamMemoryService.spaces({
      expectedSessionSpaceSlugs: await expectedSessionSpaceSlugs(ctx),
    });
    const current = spaces.find((space) => space.current) ?? spaces[0] ?? null;
    return c.json({
      currentServerId: current?.serverId ?? "",
      currentServerSlug: current?.slug ?? "",
      currentSessionSpaceSlug: current?.sessionSpaceSlug ?? "",
      spaces,
    });
  });

  api.get("/memory/catalog", async (c) => {
    const { workstreamMemoryService } = await import("../workstream-memory-service.js");
    let options;
    try {
      options = await resolveMemorySpaceOptions(ctx, c);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (!options.readOnly) {
      await workstreamMemoryService.ensureRepo(options);
    }
    const recentLimit = parseRecentLimit(c.req.query("recentLimit"));
    const [catalog, lock, gitStatus, recentCommits] = await Promise.all([
      workstreamMemoryService.catalog(options),
      workstreamMemoryService.lockStatus(options),
      workstreamMemoryService.gitStatus(options),
      workstreamMemoryService.recentCommits(options, recentLimit),
    ]);
    const statusEntries = parseGitStatus(gitStatus);
    return c.json({
      repo: catalog.repo,
      entries: catalog.entries,
      issues: catalog.issues,
      issueCounts: issueCounts(catalog.issues),
      lock,
      git: {
        dirty: statusEntries.length > 0,
        status: gitStatus,
        statusEntries,
        recentCommits,
      },
    });
  });

  api.get("/memory/records", async (c) => {
    const path = c.req.query("path")?.trim();
    if (!path) return c.json({ error: "path query parameter is required" }, 400);

    const { workstreamMemoryService } = await import("../workstream-memory-service.js");
    try {
      const options = await resolveMemorySpaceOptions(ctx, c);
      const record = await workstreamMemoryService.readRecord(path, options);
      const catalog = await workstreamMemoryService.catalog(options);
      return c.json({
        repo: record.repo,
        file: record.file,
        issues: issuesForPath(catalog.issues, record.file.path),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found|ENOENT/i.test(message) ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  api.get("/memory/updates/:sha", async (c) => {
    const sha = c.req.param("sha")?.trim();
    if (!sha) return c.json({ error: "sha path parameter is required" }, 400);

    const { workstreamMemoryService } = await import("../workstream-memory-service.js");
    try {
      const options = await resolveMemorySpaceOptions(ctx, c);
      const update = await workstreamMemoryService.commitDiff(options, sha);
      if (!update) return c.json({ error: "memory update not found" }, 404);
      return c.json(update);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, /invalid/i.test(message) ? 400 : 404);
    }
  });

  // The server is the only writer of memory data: the `memory` CLI sends every
  // command that writes (including catalog bookkeeping) here instead of
  // touching the repo from its own process.
  api.post("/memory/command", async (c) => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth && "response" in auth) return auth.response;
    const request = parseMemoryCommandRequest(await c.req.json().catch(() => null));
    if (!request) return c.json({ error: "Expected { args: string[], context: object }" }, 400);
    const { runMemoryCommand } = await import("../memory-command.js");
    const { context, files } = request;
    const result = await runMemoryCommand(request.args, {
      defaults: { serverId: getServerId(), serverSlug: getServerSlug(), ...context.defaults },
      ...(auth ? { session: auth.callerId } : context.session ? { session: context.session } : {}),
      ...(context.catalogSessionKey ? { catalogSessionKey: context.catalogSessionKey } : {}),
      // A lock outlives its holder when the holder's process is gone; unknown sessions hold nothing.
      isSessionGone: (session) => {
        const id = ctx.resolveId(session);
        const info = id ? ctx.launcher.getSession(id) : undefined;
        return !info || info.state === "exited";
      },
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

function parseMemoryCommandRequest(body: unknown): MemoryServerCommandRequest | null {
  if (!body || typeof body !== "object") return null;
  const { args, context, files } = body as Record<string, unknown>;
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return null;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const raw = context as Record<string, unknown>;
  const defaults = raw.defaults && typeof raw.defaults === "object" ? (raw.defaults as Record<string, unknown>) : {};
  return {
    args,
    context: {
      defaults: {
        ...stringField(defaults, "root"),
        ...stringField(defaults, "serverId"),
        ...stringField(defaults, "sessionSpaceSlug"),
      },
      ...stringField(raw, "session"),
      ...stringField(raw, "catalogSessionKey"),
    },
    ...(files && typeof files === "object" && !Array.isArray(files)
      ? { files: Object.fromEntries(Object.entries(files).filter(([, value]) => typeof value === "string")) }
      : {}),
  };
}

function stringField<K extends string>(record: Record<string, unknown>, key: K): Partial<Record<K, string>> {
  const value = record[key];
  return typeof value === "string" && value.trim() ? ({ [key]: value } as Record<K, string>) : {};
}
