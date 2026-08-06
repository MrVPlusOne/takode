export const OPEN_SESSION_INFO_EVENT = "takode:open-session-info";

export type SessionInfoSection = "codex-goal";

export interface OpenSessionInfoEventDetail {
  sessionId: string;
  section?: SessionInfoSection;
}

export function openSessionInfo(detail: OpenSessionInfoEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenSessionInfoEventDetail>(OPEN_SESSION_INFO_EVENT, { detail }));
}
