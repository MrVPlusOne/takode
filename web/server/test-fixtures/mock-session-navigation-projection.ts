import { SESSION_NAVIGATION_PROJECTION } from "../../shared/session-navigation-projection.js";
import { buildSessionNavigationProjectionValue } from "../session-navigation-projection.js";

export function createMockSessionNavigationProjectionController(deps: {
  getSession: (sessionId: string) => any;
  getLauncherSessionInfo: (sessionId: string) => any;
  getSessionName: (sessionId: string) => string | undefined;
  getPendingTimerCount: (sessionId: string) => number;
  getBackendConnected: (sessionId: string) => boolean;
}) {
  return {
    getSnapshot(projection: string, sessionId: string) {
      if (projection !== SESSION_NAVIGATION_PROJECTION) return null;
      const session = deps.getSession(sessionId);
      if (!session) return null;
      const value = buildSessionNavigationProjectionValue(session, {
        ...deps,
        getSessionStatus: () =>
          session.state?.is_compacting
            ? "compacting"
            : deps.getBackendConnected(sessionId)
              ? session.isGenerating
                ? "running"
                : "idle"
              : null,
        getLastActivityAt: () => deps.getLauncherSessionInfo(sessionId)?.lastActivityAt,
        getLastUserMessageAt: () => deps.getLauncherSessionInfo(sessionId)?.lastUserMessageAt,
        getLastMessagePreviewAt: () => session.lastMessagePreviewAt,
        authorizeSubscription: () => true,
      });
      return { projection, key: sessionId, generation: "test-generation", revision: 1, value };
    },
  };
}
