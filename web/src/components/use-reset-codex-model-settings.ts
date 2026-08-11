import { useCallback } from "react";
import { getDefaultModelForBackend } from "../../shared/backend-defaults.js";
import { resolveSessionDefaultsForRole } from "../../shared/session-defaults.js";
import { api } from "../api.js";
import { sendToSession } from "../ws.js";

export function useResetCodexModelSettings(options: {
  sessionId: string;
  isLeaderSession: boolean;
  model: string | undefined;
  reasoningEffort: string;
  serviceTier: string | null;
}): () => Promise<void> {
  const { sessionId, isLeaderSession, model, reasoningEffort, serviceTier } = options;

  return useCallback(async () => {
    const settings = await api.getSettings();
    const defaults = resolveSessionDefaultsForRole(
      settings.sessionDefaults,
      isLeaderSession ? "leader" : "worker",
    ).codex;
    const defaultModel = defaults.model || getDefaultModelForBackend("codex");

    if (defaultModel !== model) {
      sendToSession(sessionId, { type: "set_model", model: defaultModel });
    }
    if (defaults.reasoningEffort !== reasoningEffort) {
      sendToSession(sessionId, { type: "set_codex_reasoning_effort", effort: defaults.reasoningEffort });
    }
    if (defaults.serviceTier !== serviceTier) {
      sendToSession(sessionId, { type: "set_codex_service_tier", serviceTier: defaults.serviceTier });
    }
  }, [isLeaderSession, model, reasoningEffort, serviceTier, sessionId]);
}
