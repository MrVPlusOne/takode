import type { ModelProvenanceMigration } from "./model-identity-contract.js";
import type { BrowserIncomingMessage, SessionState } from "./session-types.js";

interface MigrationSession {
  state: Pick<SessionState, "model" | "modelProvenanceMigration">;
}

export function deliverModelProvenanceMigration(
  sessionId: string,
  migration: ModelProvenanceMigration,
  deps: {
    getOrCreateSession: (sessionId: string, backendType: "codex") => MigrationSession;
    persistSessionById: (sessionId: string) => void;
    broadcastToSession: (sessionId: string, message: BrowserIncomingMessage) => void;
  },
): void {
  const session = deps.getOrCreateSession(sessionId, "codex");
  session.state.model = migration.selectedModel;
  session.state.modelProvenanceMigration = migration;
  deps.persistSessionById(sessionId);
  deps.broadcastToSession(sessionId, {
    type: "session_update",
    session: { model: migration.selectedModel, modelProvenanceMigration: migration },
  });
}
