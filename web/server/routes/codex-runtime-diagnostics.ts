import { Hono } from "hono";
import { resolveCompanionCodexSessionHome } from "../codex-home.js";
import { readCodexRolloutRuntimeDiagnostics } from "../codex-rollout-runtime-diagnostics.js";
import type { RouteContext } from "./context.js";

export function createCodexRuntimeDiagnosticsRoutes(ctx: RouteContext) {
  const api = new Hono();

  api.get("/sessions/:id/codex-runtime-diagnostics", async (c) => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth && "response" in auth) return auth.response;

    const sessionId = ctx.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const session = ctx.launcher.getSession(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const bridgeSession = ctx.wsBridge.getSession(sessionId);
    if (session.backendType !== "codex" && bridgeSession?.backendType !== "codex") {
      return c.json({ error: "Codex runtime diagnostics are only available for Codex sessions" }, 400);
    }

    const codexSessionHome = resolveCompanionCodexSessionHome(sessionId, session.codexHome);
    const diagnostics = await readCodexRolloutRuntimeDiagnostics(codexSessionHome, session.cliSessionId ?? "");
    return c.json({
      codexMultiAgentVersion: session.codexMultiAgentVersion ?? null,
      ...diagnostics,
    });
  });

  return api;
}
