import { Hono } from "hono";
import type { RouteContext } from "./context.js";

export function createCodexUpstreamProgressProxyRoutes(ctx: RouteContext) {
  const api = new Hono();

  const handle = async (c: import("hono").Context) => {
    if (!ctx.codexUpstreamProgressProxy) return c.text("Codex upstream progress proxy is unavailable", 404);
    const token = c.req.param("token");
    if (!token) return c.text("Missing proxy token", 400);
    const pathPrefix = "/api/codex-upstream-progress-proxy/" + token;
    const proxiedPath = new URL(c.req.url).pathname.slice(pathPrefix.length) || "/";
    return ctx.codexUpstreamProgressProxy.handleRequest(c.req.raw, token, proxiedPath);
  };

  api.all("/codex-upstream-progress-proxy/:token", handle);
  api.all("/codex-upstream-progress-proxy/:token/*", handle);

  return api;
}
