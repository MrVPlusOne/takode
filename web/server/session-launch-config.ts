import type { SdkSessionInfo } from "./session-info.js";
import { resolveModelAuthority } from "./model-identity-contract.js";

export type SessionLaunchConfigPatch = Partial<
  Pick<
    SdkSessionInfo,
    | "model"
    | "permissionMode"
    | "askPermission"
    | "uiMode"
    | "codexInternetAccess"
    | "codexSandbox"
    | "codexReasoningEffort"
    | "codexMultiAgentVersion"
    | "codexWorkerV2Cutover"
    | "cliSessionId"
    | "resumeRetried"
    | "codexServiceTier"
    | "codexMaxContextLength"
    | "codexLeaderCompactionMode"
    | "claudeReasoningEffort"
    | "claudeMaxContextLength"
  >
>;

/**
 * Apply launch-config updates to a session, returning whether anything changed.
 * A new Codex model also becomes the session's model authority, so a relaunch
 * keeps the chosen model instead of restoring an earlier or default one.
 * Throws, before changing anything, when a Codex model is not a valid model id.
 */
export function applySessionLaunchConfigPatch(info: SdkSessionInfo, updates: SessionLaunchConfigPatch): boolean {
  const modelAuthority =
    info.backendType === "codex" && typeof updates.model === "string" && updates.model !== info.model
      ? resolveModelAuthority([{ source: "explicit_request", model: updates.model, precedence: 400 }])
      : undefined;
  let changed = false;
  for (const key of Object.keys(updates) as Array<keyof SessionLaunchConfigPatch>) {
    const next = updates[key];
    if (info[key] === next) continue;
    (info as unknown as Record<string, unknown>)[key] = next;
    changed = true;
  }
  if (modelAuthority) info.modelAuthority = modelAuthority;
  return changed;
}
