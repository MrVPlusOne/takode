import { Hono } from "hono";
import * as questStore from "../quest-store.js";
import * as sessionNames from "../session-names.js";
import {
  searchEverything,
  type SearchEverythingCategory,
  type SearchEverythingQuestDocument,
  type SearchEverythingSessionDocument,
} from "../search-everything.js";
import type { RouteContext } from "./context.js";

const ALL_CATEGORIES: SearchEverythingCategory[] = ["quests", "sessions", "messages"];
const CATEGORY_SET = new Set<SearchEverythingCategory>(ALL_CATEGORIES);
const ROUTE_LIMITS = {
  maxQuestDocuments: 500,
  maxQuestHistoryLookups: 50,
  maxQuestHistoryVersionsPerQuest: 8,
  maxQuestHistoryConcurrency: 4,
  maxSessionDocuments: 200,
  defaultMessageLimitPerSession: 120,
  maxMessageLimitPerSession: 400,
};

export function createSearchRoutes(ctx: RouteContext) {
  const api = new Hono();
  const { launcher, wsBridge } = ctx;

  api.get("/search", async (c) => {
    const rawQuery = (c.req.query("q") || "").trim();
    if (!rawQuery) {
      return c.json({ error: "q is required" }, 400);
    }

    const startedAt = Date.now();
    const categories = parseCategories(c.req.query("types"));
    const limit = parseIntParam(c.req.query("limit"), 30, 1, 100);
    const childPreviewLimit = parseIntParam(c.req.query("childPreviewLimit"), 3, 1, 8);
    const messageLimitPerSession = parseIntParam(
      c.req.query("messageLimitPerSession"),
      ROUTE_LIMITS.defaultMessageLimitPerSession,
      20,
      ROUTE_LIMITS.maxMessageLimitPerSession,
    );
    const includeArchived = parseAffirmativeBoolean(c.req.query("includeArchived"));
    const includeReviewers = parseAffirmativeBoolean(c.req.query("includeReviewers"));
    const currentSessionId = normalizeNullableString(c.req.query("currentSessionId"));
    const routeWarnings: string[] = [];

    const questDocumentsPromise = categories.includes("quests")
      ? buildQuestDocuments(routeWarnings)
      : Promise.resolve([]);
    const sessionDocumentsPromise =
      categories.includes("sessions") || categories.includes("messages")
        ? buildSessionDocuments(routeWarnings)
        : Promise.resolve([]);
    const [quests, sessionDocs] = await Promise.all([questDocumentsPromise, sessionDocumentsPromise]);
    const output = searchEverything(quests, sessionDocs, {
      query: rawQuery,
      categories,
      currentSessionId,
      includeArchived,
      includeReviewers,
      limit,
      childPreviewLimit,
      messageLimitPerSession,
      limits: {
        maxQuestDocuments: ROUTE_LIMITS.maxQuestDocuments,
        maxQuestHistoryVersionsPerQuest: ROUTE_LIMITS.maxQuestHistoryVersionsPerQuest,
        maxSessionDocuments: ROUTE_LIMITS.maxSessionDocuments,
      },
    });

    return c.json({
      ...output,
      degraded: output.degraded || routeWarnings.length > 0,
      warnings: [...output.warnings, ...routeWarnings],
      tookMs: Date.now() - startedAt,
    });
  });

  return api;

  async function buildQuestDocuments(routeWarnings: string[]): Promise<SearchEverythingQuestDocument[]> {
    const quests = sortByRecentActivity(await questStore.listQuests());
    const boundedQuests = quests.slice(0, ROUTE_LIMITS.maxQuestDocuments);
    if (quests.length > boundedQuests.length) {
      routeWarnings.push(`Quest search limited to ${boundedQuests.length} quests.`);
    }
    const historyLookupQuests = boundedQuests.slice(0, ROUTE_LIMITS.maxQuestHistoryLookups);
    if (quests.length > historyLookupQuests.length) {
      routeWarnings.push(`Quest history lookup limited to ${historyLookupQuests.length} recent quests.`);
    }
    const historyEntries = await mapWithConcurrency(
      historyLookupQuests,
      ROUTE_LIMITS.maxQuestHistoryConcurrency,
      async (quest) => {
        const historyView = await questStore.getQuestHistoryView(quest.questId);
        return [quest.questId, historyView.entries.slice(0, ROUTE_LIMITS.maxQuestHistoryVersionsPerQuest)] as const;
      },
    );
    const historyByQuest = new Map(historyEntries);
    return boundedQuests.map((quest) => ({
      quest,
      history: historyByQuest.get(quest.questId) ?? [],
    }));
  }

  async function buildSessionDocuments(routeWarnings: string[]): Promise<SearchEverythingSessionDocument[]> {
    const sessions = sortByRecentActivity(launcher.listSessions());
    const boundedSessions = sessions.slice(0, ROUTE_LIMITS.maxSessionDocuments);
    if (sessions.length > boundedSessions.length) {
      routeWarnings.push(`Session search limited to ${boundedSessions.length} sessions.`);
    }
    const names = sessionNames.getAllNames();
    return boundedSessions.map((session) => {
      const bridgeSession = wsBridge.getSession(session.sessionId);
      const bridge = bridgeSession?.state;
      return {
        sessionId: session.sessionId,
        sessionNum: launcher.getSessionNum(session.sessionId) ?? null,
        archived: !!session.archived,
        reviewerOf: session.reviewerOf,
        createdAt: session.createdAt || 0,
        lastActivityAt: session.lastActivityAt,
        name: names[session.sessionId] ?? session.name ?? "",
        taskHistory: bridgeSession?.taskHistory ?? [],
        keywords: bridgeSession?.keywords ?? [],
        gitBranch: bridge?.git_branch || "",
        cwd: bridge?.cwd || session.cwd || "",
        repoRoot: bridge?.repo_root || session.repoRoot || "",
        messageHistory: bridgeSession?.messageHistory || [],
        searchExcerpts: bridgeSession?.searchExcerpts ?? [],
      };
    });
  }
}

function sortByRecentActivity<
  T extends { createdAt?: number; updatedAt?: number; statusChangedAt?: number; lastActivityAt?: number },
>(items: T[]): T[] {
  return [...items].sort((left, right) => itemRecency(right) - itemRecency(left));
}

function itemRecency(item: {
  createdAt?: number;
  updatedAt?: number;
  statusChangedAt?: number;
  lastActivityAt?: number;
}) {
  return Math.max(item.lastActivityAt ?? 0, item.updatedAt ?? 0, item.statusChangedAt ?? 0, item.createdAt ?? 0);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex++;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    }),
  );
  return results;
}

function parseCategories(rawValue: string | undefined): SearchEverythingCategory[] {
  if (!rawValue) return ALL_CATEGORIES;
  const parsed = rawValue
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is SearchEverythingCategory => CATEGORY_SET.has(part as SearchEverythingCategory));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : ALL_CATEGORIES;
}

function parseIntParam(rawValue: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(rawValue || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseAffirmativeBoolean(rawValue: string | undefined): boolean {
  if (rawValue === undefined) return false;
  return ["1", "true", "yes"].includes(rawValue.toLowerCase());
}

function normalizeNullableString(rawValue: string | undefined): string | null {
  const trimmed = rawValue?.trim();
  return trimmed ? trimmed : null;
}
