import type { Hono } from "hono";
import type { LaunchOptions } from "../cli-launcher.js";
import type { RouteContext } from "./context.js";

export function resolveCodexSandboxForPermissionMode(permissionMode: string): LaunchOptions["codexSandbox"] {
  switch (permissionMode) {
    case "codex-custom":
      return undefined;
    case "codex-auto-review":
      return "workspace-write";
    case "codex-full-access":
    case "bypassPermissions":
      return "danger-full-access";
    case "codex-default":
    default:
      return "workspace-write";
  }
}

export function registerSessionPermissionModeRoute(api: Hono, ctx: RouteContext): void {
  const { launcher, wsBridge, resolveId } = ctx;

  api.post("/sessions/:id/permission-mode", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const mode = typeof body.mode === "string" ? body.mode.trim() : "";
    if (!mode) return c.json({ error: "mode is required" }, 400);

    const info = launcher.getSession(id);
    if (!info) return c.json({ error: "Session not found" }, 404);

    const leaderId = typeof body.leaderSessionId === "string" ? resolveId(body.leaderSessionId) : null;
    if (leaderId) {
      const leader = launcher.getSession(leaderId);
      if (!leader?.isOrchestrator) return c.json({ error: "Leader session not found" }, 404);
      if (info.herdedBy !== leaderId) {
        return c.json({ error: "Only the leader who herded this session can change its mode" }, 403);
      }
    }

    wsBridge.getOrCreateSession(id, info.backendType || "claude");
    const ok = await wsBridge.setSessionPermissionMode(id, mode);
    if (!ok) return c.json({ error: "Session not found" }, 404);
    return c.json({ ok: true, sessionId: id, permissionMode: mode });
  });
}
