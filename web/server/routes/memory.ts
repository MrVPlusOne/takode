import { Hono } from "hono";
import type { MemoryLintIssue } from "../workstream-memory-types.js";
import type { RouteContext } from "./context.js";

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

export function createMemoryRoutes(_ctx: RouteContext) {
  const api = new Hono();

  api.get("/memory/spaces", async (c) => {
    const { workstreamMemoryService } = await import("../workstream-memory-service.js");
    const spaces = await workstreamMemoryService.spaces();
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
    const options = await workstreamMemoryService.resolveSpaceOptions(c.req.query("serverSlug"));
    if (!options.readOnly) {
      await workstreamMemoryService.ensureRepo(options);
    }
    const [catalog, lock, gitStatus, recentCommits] = await Promise.all([
      workstreamMemoryService.catalog(options),
      workstreamMemoryService.lockStatus(options),
      workstreamMemoryService.gitStatus(options),
      workstreamMemoryService.recentCommits(options, 8),
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
    const options = await workstreamMemoryService.resolveSpaceOptions(c.req.query("serverSlug"));
    try {
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

  return api;
}
