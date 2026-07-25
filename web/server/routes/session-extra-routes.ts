import type { Hono } from "hono";
import type { RouteContext } from "./context.js";
import { registerSessionConfigRoutes } from "./session-config-routes.js";
import { registerSessionDelegateRoutes } from "./session-delegate-routes.js";
import { registerSessionSideChatRoutes } from "./session-side-chat-routes.js";

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
  registerSessionSideChatRoutes(api, { launcher, wsBridge, resolveId });
  registerSessionDelegateRoutes(api, { launcher, wsBridge, sessionStore, resolveId, authenticateTakodeCaller });
  registerSessionConfigRoutes(api, { launcher, wsBridge, resolveId });
}
