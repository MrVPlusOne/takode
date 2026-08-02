import type { SdkSessionInfo, SessionNotification } from "../types.js";
import { countGlobalNeedsInputNotifications } from "./global-needs-input.js";

interface DocumentTitleAttentionState {
  sdkSessions: SdkSessionInfo[];
  sessionNotifications: Map<string, SessionNotification[]>;
}

export function getDocumentTitleAttentionCount(state: DocumentTitleAttentionState): number {
  return countGlobalNeedsInputNotifications({
    sessionNotifications: state.sessionNotifications,
    sdkSessions: state.sdkSessions,
  });
}

export function formatDocumentTitle(base: string, needsInputCount: number): string {
  return needsInputCount > 0 ? `(${needsInputCount}) ${base}` : base;
}
