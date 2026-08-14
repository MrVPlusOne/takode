import type { SdkSessionInfo } from "./session-info.js";

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

export function applySessionLaunchConfigPatch(info: SdkSessionInfo, updates: SessionLaunchConfigPatch): boolean {
  let changed = false;
  for (const key of Object.keys(updates) as Array<keyof SessionLaunchConfigPatch>) {
    const next = updates[key];
    if (info[key] === next) continue;
    (info as unknown as Record<string, unknown>)[key] = next;
    changed = true;
  }
  return changed;
}
