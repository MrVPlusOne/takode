import type { Hono } from "hono";
import { buildContextDiagnostics } from "../context-diagnostics.js";
import type { RouteContext } from "./context.js";

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function registerTakodeContextDiagnosticsRoutes(api: Hono, ctx: RouteContext): void {
  const { authenticateTakodeCaller, launcher, resolveId, wsBridge } = ctx;

  api.get("/sessions/:id/context-diagnostics", (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;

    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);

    const session = wsBridge.getSession(sessionId);
    if (!session) return c.json({ error: "Session not found in bridge" }, 404);

    return c.json(
      buildContextDiagnostics(session, {
        sessionNum: launcher.getSessionNum(sessionId) ?? null,
        limit: parseLimit(c.req.query("limit")),
        includeHistory: c.req.query("history") === "true",
      }),
    );
  });
}
