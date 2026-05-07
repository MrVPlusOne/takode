import type { Hono } from "hono";
import type { LaunchOptions } from "../cli-launcher.js";
import type { RouteContext } from "./context.js";
import {
  CODEX_PERMISSION_PROFILES,
  isClaudePermissionMode,
  normalizeCodexPermissionProfile,
} from "../../shared/permission-modes.js";

export function resolveCodexSandboxForPermissionMode(permissionMode: string): LaunchOptions["codexSandbox"] {
  switch (normalizeCodexPermissionProfile(permissionMode)) {
    case "codex-custom":
      return undefined;
    case "codex-auto-review":
      return "workspace-write";
    case "codex-full-access":
      return "danger-full-access";
    case "codex-default":
      return "workspace-write";
  }
}

function resolvePermissionBackend(backendType: string | undefined): "claude" | "codex" | null {
  if (backendType === "codex") return "codex";
  if (!backendType || backendType === "claude" || backendType === "claude-sdk") return "claude";
  return null;
}

function isValidPermissionModeForBackend(backend: "claude" | "codex", mode: string): boolean {
  if (backend === "codex")
    return CODEX_PERMISSION_PROFILES.includes(mode as (typeof CODEX_PERMISSION_PROFILES)[number]);
  return isClaudePermissionMode(mode);
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
    const backend = resolvePermissionBackend(info.backendType);
    if (!backend) {
      return c.json({ error: `Unsupported backend for permission modes: ${info.backendType}` }, 400);
    }
    if (!isValidPermissionModeForBackend(backend, mode)) {
      return c.json({ error: `Unsupported permission mode for ${info.backendType || "claude"} session: ${mode}` }, 400);
    }

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
