import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";
import { LEADER_KICKOFF_SOURCE_ID, LEADER_KICKOFF_SOURCE_LABEL } from "../../shared/injected-event-message.js";
import {
  buildLeaderPreloadDeliveryContent,
  buildLeaderSkillPreloadBundles,
  buildLeaderSkillPreloadHistoryFollowUps,
} from "../leader-skill-preload.js";
import {
  buildMemoryCatalogDeliveryContent,
  buildMemoryCatalogHistoryFollowUp,
} from "../memory-catalog-injection-utils.js";
import { markOrchestratorSessionAfterConnect, type SessionBackend } from "./sessions-helpers.js";

export function markOrchestratorSessionWithStartupContext(
  deps: {
    launcher: CliLauncher;
    wsBridge: WsBridge;
    buildOrchestratorSystemPrompt: (backend: SessionBackend) => string;
  },
  sessionId: string,
  backend: SessionBackend,
): void {
  markOrchestratorSessionAfterConnect(
    { launcher: deps.launcher, wsBridge: deps.wsBridge },
    sessionId,
    async () => {
      const content = deps.buildOrchestratorSystemPrompt(backend);
      try {
        const { buildMemoryCatalogInjectionBundle } = await import("../memory-catalog-injection.js");
        const [preloads, memoryCatalog] = await Promise.all([
          buildLeaderSkillPreloadBundles(),
          buildMemoryCatalogInjectionBundle({
            sessionId,
            repoOptions: { sessionSpaceSlug: deps.wsBridge.getSession(sessionId)?.state.memorySessionSpaceSlug },
          }),
        ]);
        const leaderDeliveryContent = buildLeaderPreloadDeliveryContent(content, preloads);
        return {
          content,
          deliveryContent: buildMemoryCatalogDeliveryContent(leaderDeliveryContent, memoryCatalog),
          historyFollowUps: [
            ...buildLeaderSkillPreloadHistoryFollowUps(preloads),
            ...buildMemoryCatalogHistoryFollowUp(memoryCatalog),
          ],
        };
      } catch (err) {
        console.error("[routes] Failed to build leader startup context:", err);
        return { content };
      }
    },
    {
      sessionId: LEADER_KICKOFF_SOURCE_ID,
      sessionLabel: LEADER_KICKOFF_SOURCE_LABEL,
    },
  );
}
