import type { Hono } from "hono";
import {
  normalizeViewportHandoffThreadKey,
  type ViewportHandoffReadResponse,
  type ViewportHandoffWriteRequest,
} from "../../shared/viewport-handoff.js";
import type { CliLauncher } from "../cli-launcher.js";
import { ViewportHandoffStoreError, type ViewportHandoffStore } from "../viewport-handoff-store.js";

export interface SessionViewportHandoffRouteDeps {
  launcher: CliLauncher;
  resolveId: (idOrNum: string) => string | null;
  viewportHandoffStore: ViewportHandoffStore;
}

export function registerSessionViewportHandoffRoute(api: Hono, deps: SessionViewportHandoffRouteDeps): void {
  const { launcher, resolveId, viewportHandoffStore } = deps;

  api.get("/sessions/:id/viewport-handoff", async (c) => {
    const resolved = resolveSession(c.req.param("id"), deps);
    if (resolved instanceof Response) return resolved;
    const requestedThreadKey = c.req.query("threadKey");
    try {
      if (requestedThreadKey === undefined) {
        const state = await viewportHandoffStore.readSession(resolved.sessionId);
        if (!resolved.isLeader && !stateIsNormalSessionOnly(state)) {
          return c.json(
            {
              error: "Viewport handoff state is not valid for a non-leader session",
            },
            409,
          );
        }
        return c.json({
          state,
          serverNow: Math.max(Date.now(), state.updatedAt),
        } satisfies ViewportHandoffReadResponse);
      }

      const threadKey = validateThreadKeyForSession(requestedThreadKey, resolved.isLeader);
      if (!threadKey) return c.json({ error: "Invalid viewport handoff thread key" }, 400);
      const { state, record } = await viewportHandoffStore.readThread(resolved.sessionId, threadKey);
      if (!resolved.isLeader && !stateIsNormalSessionOnly(state)) {
        return c.json(
          {
            error: "Viewport handoff state is not valid for a non-leader session",
          },
          409,
        );
      }
      return c.json({
        state,
        threadKey,
        record,
        serverNow: Math.max(Date.now(), state.updatedAt),
      } satisfies ViewportHandoffReadResponse);
    } catch (error) {
      return viewportHandoffErrorResponse(c, error);
    }
  });

  api.put("/sessions/:id/viewport-handoff", async (c) => {
    const resolved = resolveSession(c.req.param("id"), deps);
    if (resolved instanceof Response) return resolved;
    const body = (await c.req.json().catch(() => null)) as ViewportHandoffWriteRequest | null;
    if (!body || typeof body !== "object") return c.json({ error: "Viewport handoff body is required" }, 400);
    const threadKey = validateThreadKeyForSession(body.threadKey, resolved.isLeader);
    const selectedThreadKey = validateThreadKeyForSession(body.selectedThreadKey, resolved.isLeader);
    if (!threadKey || !selectedThreadKey) {
      return c.json({ error: "Invalid viewport handoff thread key for this session" }, 400);
    }

    try {
      const result = await viewportHandoffStore.publish(
        resolved.sessionId,
        { ...body, threadKey, selectedThreadKey },
        Date.now(),
      );
      return c.json(result);
    } catch (error) {
      return viewportHandoffErrorResponse(c, error);
    }
  });
}

function resolveSession(
  rawId: string,
  deps: Pick<SessionViewportHandoffRouteDeps, "launcher" | "resolveId">,
): { sessionId: string; isLeader: boolean } | Response {
  const sessionId = deps.resolveId(rawId);
  if (!sessionId) return Response.json({ error: "Session not found" }, { status: 404 });
  const info = deps.launcher.getSession(sessionId);
  if (!info) return Response.json({ error: "Session not found" }, { status: 404 });
  return { sessionId, isLeader: info.isOrchestrator === true };
}

function validateThreadKeyForSession(value: unknown, isLeader: boolean): string | null {
  const threadKey = normalizeViewportHandoffThreadKey(value);
  if (!threadKey || (!isLeader && threadKey !== "main")) return null;
  return threadKey;
}

function stateIsNormalSessionOnly(state: { selectedThreadKey: string; handoffs: Record<string, unknown> }): boolean {
  return state.selectedThreadKey === "main" && Object.keys(state.handoffs).every((threadKey) => threadKey === "main");
}

function viewportHandoffErrorResponse(c: any, error: unknown): Response {
  if (error instanceof ViewportHandoffStoreError) {
    const status = error.code === "invalid_input" ? 400 : error.code === "invalid_state" ? 409 : 500;
    return c.json({ error: error.message, code: error.code }, status);
  }
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
}
