import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import type { ModelProvenanceMigrationAcknowledgementStore } from "./model-provenance-migration-acknowledgement-store.js";
import {
  normalizeModelProvenanceMigration,
  projectModelProvenanceMigrationAcknowledgement,
} from "./model-provenance-migration.js";

export function projectModelProvenanceMigrationFamilies(
  launcher: Pick<CliLauncher, "listSessions">,
  wsBridge: Pick<WsBridge, "getSession" | "broadcastToSession" | "broadcastGlobal">,
  store: Pick<ModelProvenanceMigrationAcknowledgementStore, "getAcknowledgedAt">,
  options: { eventId?: string; broadcast?: boolean } = {},
): string[] {
  const projectedSessionIds: string[] = [];
  for (const info of launcher.listSessions()) {
    const launcherMigration = info.modelProvenanceMigration;
    const bridgeSession = wsBridge.getSession(info.sessionId);
    const bridgeMigration = bridgeSession?.state.modelProvenanceMigration;
    const sourceMigration = bridgeMigration ?? launcherMigration;
    if (!sourceMigration) continue;

    const normalized = normalizeModelProvenanceMigration(sourceMigration);
    if (options.eventId && normalized.eventId !== options.eventId) continue;
    const projected = projectModelProvenanceMigrationAcknowledgement(
      normalized,
      store.getAcknowledgedAt(normalized.eventId),
    );
    info.modelProvenanceMigration = projected;
    if (bridgeSession) bridgeSession.state.modelProvenanceMigration = projected;
    projectedSessionIds.push(info.sessionId);

    if (options.broadcast) {
      const message = { type: "session_update" as const, session: { modelProvenanceMigration: projected } };
      wsBridge.broadcastToSession(info.sessionId, message);
      wsBridge.broadcastGlobal({
        type: "session_activity_update",
        session_id: info.sessionId,
        session: { modelProvenanceMigration: projected },
      });
    }
  }
  return projectedSessionIds;
}
