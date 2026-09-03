import type { Hono } from "hono";
import type { RouteContext } from "./context.js";
import { registerSessionConfigRoutes } from "./session-config-routes.js";
import { registerSessionDelegateRoutes } from "./session-delegate-routes.js";
import { registerSessionSideChatRoutes } from "./session-side-chat-routes.js";
import { registerSessionCodexNativeSubagentRoutes } from "./session-codex-native-subagent-routes.js";
import { registerSessionViewportHandoffRoute } from "./session-viewport-handoff-route.js";
import { join } from "node:path";
import { ViewportHandoffStore } from "../viewport-handoff-store.js";

export function registerSessionExtraRoutes(
  api: Hono,
  deps: {
    launcher: RouteContext["launcher"];
    wsBridge: RouteContext["wsBridge"];
    sessionStore: RouteContext["sessionStore"];
    resolveId: (id: string) => string | null;
    authenticateTakodeCaller: RouteContext["authenticateTakodeCaller"];
  },
): void {
  const { launcher, wsBridge, sessionStore, resolveId, authenticateTakodeCaller } = deps;
  const viewportHandoffStore =
    typeof sessionStore.directory === "string"
      ? new ViewportHandoffStore(join(sessionStore.directory, "viewport-handoffs"))
      : ViewportHandoffStore.createVolatileForTest();
  api.use("/sessions/:id", async (c, next) => {
    if (c.req.method !== "DELETE") return next();
    const sessionId = resolveId(c.req.param("id"));
    await next();
    if (!sessionId || !c.res.ok) return;
    await viewportHandoffStore.deleteSession(sessionId).catch((error) => {
      console.warn(`[viewport-handoff] Failed to remove state for ${sessionId.slice(0, 8)}:`, error);
    });
  });
  registerSessionSideChatRoutes(api, { launcher, wsBridge, resolveId });
  registerSessionDelegateRoutes(api, {
    launcher,
    wsBridge,
    sessionStore,
    resolveId,
    authenticateTakodeCaller,
  });
  registerSessionConfigRoutes(api, { launcher, wsBridge, resolveId });
  registerSessionCodexNativeSubagentRoutes(api, { wsBridge, resolveId });
  registerSessionViewportHandoffRoute(api, {
    launcher,
    resolveId,
    viewportHandoffStore,
  });
}
