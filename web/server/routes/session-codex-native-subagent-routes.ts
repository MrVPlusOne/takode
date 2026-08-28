import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { RouteContext } from "./context.js";
import { toPublicCodexNativeSubagentOwnership } from "../../shared/codex-native-subagent-types.js";
import {
  loadProviderCodexNativeSubagentHistoryPage,
  pageForwardCapturedCodexNativeSubagentHistory,
  type CodexNativeSubagentProviderPrefixState,
} from "../codex-native-subagent-history.js";
import {
  collectCodexNativeSubagentProviderSensitiveIds,
  resolveCodexNativeSubagentProviderThreadId,
  seedCodexNativeSubagentAdapterContext,
  type CodexNativeSubagentRecord,
  type CodexNativeSubagentRegistry,
} from "../codex-native-subagent-state.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const CURSOR_TTL_MS = 10 * 60_000;
const MAX_CURSOR_ENTRIES = 500;

type CursorState =
  | { source: "local"; sessionId: string; childId: string; offset: number; createdAt: number }
  | {
      source: "provider";
      sessionId: string;
      childId: string;
      providerCursor: string | null;
      prefixState: CodexNativeSubagentProviderPrefixState;
      ancestorProviderThreadIds: string[];
      ancestorChainComplete: boolean;
      createdAt: number;
    };
type CursorInput =
  | Omit<Extract<CursorState, { source: "local" }>, "createdAt">
  | Omit<Extract<CursorState, { source: "provider" }>, "createdAt">;

function parseLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(parsed)));
}

function storeCursor(store: Map<string, CursorState>, state: CursorInput): string {
  const now = Date.now();
  for (const [token, entry] of store) {
    if (now - entry.createdAt > CURSOR_TTL_MS) store.delete(token);
  }
  while (store.size >= MAX_CURSOR_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  const token = randomUUID();
  store.set(token, { ...state, createdAt: now } as CursorState);
  return token;
}

function providerAncestorChain(
  registry: CodexNativeSubagentRegistry,
  record: CodexNativeSubagentRecord,
): { ids: string[]; complete: boolean } {
  const ids: string[] = [];
  const seen = new Set<string>();
  let child = record;
  while (child.providerParentThreadId) {
    const parentId = child.providerParentThreadId;
    if (seen.has(parentId) || ids.length >= 16) return { ids, complete: false };
    seen.add(parentId);
    ids.push(parentId);

    const parent = registry.childrenByProviderThreadId[parentId];
    if (!parent) {
      // A depth-one child's parent is the root session thread. A missing
      // intermediate record at deeper levels is not enough ancestry proof.
      return { ids, complete: child.depth === 1 };
    }
    if (child.depth !== undefined && parent.depth !== undefined && parent.depth >= child.depth) {
      return { ids, complete: false };
    }
    child = parent;
  }
  return { ids, complete: false };
}

function collectSensitiveStrings(
  session: { state?: Record<string, unknown> },
  registry: CodexNativeSubagentRegistry,
): string[] {
  const values = new Set(collectCodexNativeSubagentProviderSensitiveIds(registry));
  const state = session.state ?? {};
  for (const key of ["cwd", "repo_root", "container_workdir", "worktree_path"]) {
    const value = state[key];
    if (typeof value === "string" && value.trim()) values.add(value.trim());
  }
  return [...values];
}

export function registerSessionCodexNativeSubagentRoutes(
  api: Hono,
  deps: {
    wsBridge: RouteContext["wsBridge"];
    resolveId: (id: string) => string | null;
  },
): void {
  const cursors = new Map<string, CursorState>();

  api.get("/sessions/:id/codex-native-subagents/:childId/history", async (c) => {
    const sessionId = deps.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const session = deps.wsBridge.getSession(sessionId);
    if (!session || session.backendType !== "codex") return c.json({ error: "Codex session not found" }, 404);

    const childId = c.req.param("childId");
    const registry = session.codexNativeSubagents;
    const providerThreadId = resolveCodexNativeSubagentProviderThreadId(registry, childId);
    const record = providerThreadId ? registry.childrenByProviderThreadId[providerThreadId] : undefined;
    if (!providerThreadId || !record) return c.json({ error: "Codex subagent not found" }, 404);
    const privateOwnership = seedCodexNativeSubagentAdapterContext(registry).get(providerThreadId);
    if (!privateOwnership) {
      return c.json({ messages: [], nextCursor: null, availability: "unavailable", coverage: "partial" });
    }
    const ownership = toPublicCodexNativeSubagentOwnership(privateOwnership);
    const sensitiveStrings = collectSensitiveStrings(
      session as unknown as { state?: Record<string, unknown> },
      registry,
    );

    const limit = parseLimit(c.req.query("limit"));
    const cursorToken = c.req.query("cursor");
    const cursor = cursorToken ? cursors.get(cursorToken) : undefined;
    if (
      cursorToken &&
      (!cursor ||
        cursor.sessionId !== sessionId ||
        cursor.childId !== childId ||
        Date.now() - cursor.createdAt > CURSOR_TTL_MS)
    ) {
      return c.json({ error: "History cursor is invalid or expired" }, 400);
    }
    if (cursorToken) cursors.delete(cursorToken);

    const localPage = pageForwardCapturedCodexNativeSubagentHistory(
      session.messageHistory,
      { ownership, sensitiveStrings },
      cursor?.source === "local" ? cursor.offset : 0,
      limit,
    );
    const controller = (session.codexAdapter as any)?.getNativeSubagentController?.();
    const freshAncestorChain = providerAncestorChain(registry, record);
    const providerAvailable = !!record.providerParentThreadId && !!controller;

    if (!cursor || cursor.source === "local") {
      if (localPage.messages.length > 0) {
        let nextCursor: string | null = null;
        if (localPage.nextOffset !== null) {
          nextCursor = storeCursor(cursors, { source: "local", sessionId, childId, offset: localPage.nextOffset });
        } else if (providerAvailable) {
          nextCursor = storeCursor(cursors, {
            source: "provider",
            sessionId,
            childId,
            providerCursor: null,
            prefixState: { inheritedPrefixStarted: false },
            ancestorProviderThreadIds: freshAncestorChain.ids,
            ancestorChainComplete: freshAncestorChain.complete,
          });
        }
        return c.json({
          messages: localPage.messages,
          nextCursor,
          availability: record.transcriptAvailability === "unavailable" ? "partial" : record.transcriptAvailability,
          // Exhausting Takode's forward-captured rows does not prove that older
          // provider-only history does not exist.
          coverage: "partial",
        });
      }
    }

    if (!providerAvailable) {
      return c.json({
        messages: [],
        nextCursor: null,
        availability: record.transcriptAvailability,
        coverage: "partial",
      });
    }

    try {
      const providerCursor = cursor?.source === "provider" ? cursor : undefined;
      const page = await loadProviderCodexNativeSubagentHistoryPage({
        client: controller,
        childProviderThreadId: providerThreadId,
        ancestorProviderThreadIds: providerCursor?.ancestorProviderThreadIds ?? freshAncestorChain.ids,
        ancestorChainComplete: providerCursor?.ancestorChainComplete ?? freshAncestorChain.complete,
        ownership,
        cursor: providerCursor?.providerCursor ?? null,
        limit,
        prefixState: providerCursor?.prefixState,
        sensitiveStrings,
        excludeMessageIds: localPage.allMessageIds,
      });
      return c.json({
        messages: page.messages,
        nextCursor:
          page.nextProviderCursor === null
            ? null
            : storeCursor(cursors, {
                source: "provider",
                sessionId,
                childId,
                providerCursor: page.nextProviderCursor,
                prefixState: page.nextPrefixState,
                ancestorProviderThreadIds: providerCursor?.ancestorProviderThreadIds ?? freshAncestorChain.ids,
                ancestorChainComplete: providerCursor?.ancestorChainComplete ?? freshAncestorChain.complete,
              }),
        availability: page.availability,
        coverage: page.coverage,
      });
    } catch {
      return c.json({
        messages: [],
        nextCursor: null,
        availability: record.transcriptAvailability === "unavailable" ? "unavailable" : "partial",
        coverage: "partial",
      });
    }
  });
}
