import { Hono } from "hono";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";
import { buildEnrichedSessionsSnapshotFromEntries } from "./session-list-snapshot.js";

const DEFAULT_ARCHIVED_SESSION_PAGE_LIMIT = 25;
const MAX_ARCHIVED_SESSION_PAGE_LIMIT = 100;

type SessionListEntry = ReturnType<CliLauncher["listSessions"]>[number];

export interface ArchivedSessionPageResponse {
  sessions: Awaited<ReturnType<typeof buildEnrichedSessionsSnapshotFromEntries>>;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface ArchivedSessionSummaryResponse {
  total: number;
}

export interface ArchivedSessionPageRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  pendingWorktreeCleanups: Map<string, Promise<void>>;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function parsePageLimit(value: string | undefined): number {
  const parsed = parseNonNegativeInteger(value, DEFAULT_ARCHIVED_SESSION_PAGE_LIMIT);
  if (parsed < 1) return DEFAULT_ARCHIVED_SESSION_PAGE_LIMIT;
  return Math.min(parsed, MAX_ARCHIVED_SESSION_PAGE_LIMIT);
}

function compareArchivedSessions(a: SessionListEntry, b: SessionListEntry): number {
  return (b.archivedAt ?? b.createdAt ?? 0) - (a.archivedAt ?? a.createdAt ?? 0);
}

function getArchivedSessionEntries(launcher: CliLauncher): SessionListEntry[] {
  return launcher
    .listSessions()
    .filter((session) => session.hidden !== true && session.archived === true && session.reviewerOf === undefined)
    .sort(compareArchivedSessions);
}

export function registerArchivedSessionPageRoute(api: Hono, deps: ArchivedSessionPageRouteDeps): void {
  api.get("/sessions/archived/summary", (c) => {
    const archived = getArchivedSessionEntries(deps.launcher);
    return c.json({ total: archived.length } satisfies ArchivedSessionSummaryResponse);
  });

  api.get("/sessions/archived", async (c) => {
    const offset = parseNonNegativeInteger(c.req.query("offset"), 0);
    const limit = parsePageLimit(c.req.query("limit"));
    const archived = getArchivedSessionEntries(deps.launcher);
    const pageEntries = archived.slice(offset, offset + limit);
    const sessions = await buildEnrichedSessionsSnapshotFromEntries(deps, pageEntries);
    const nextOffset = offset + sessions.length;
    const hasMore = nextOffset < archived.length;
    return c.json({
      sessions,
      total: archived.length,
      offset,
      limit,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    } satisfies ArchivedSessionPageResponse);
  });
}
