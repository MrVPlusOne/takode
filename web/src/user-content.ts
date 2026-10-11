import { useEffect, useState } from "react";

/** One machine's last delivery of the user's instructions and skills (see server/user-content-install.ts). */
export interface UserContentMachineStatus {
  /** Null for this server's own machine. */
  hostId: string | null;
  at: number;
  error?: string;
  result?: {
    instructionFiles: { path: string; state: string }[];
    skills: { conflicts: { path: string }[] };
  };
}

/** The parts of GET /api/user-content that Settings shows; agents read the rest through `takode user-content`. */
export interface UserContentStatus {
  store: { instructions: string; skills: string };
  storeExists: boolean;
  storeEmpty: boolean;
  machines: UserContentMachineStatus[];
}

const POLL_MS = 10_000;

/** The server's user content status, refreshed while the caller is mounted. */
export function useUserContentStatus(): UserContentStatus | null {
  const [status, setStatus] = useState<UserContentStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      fetch("/api/user-content")
        .then((response) => (response.ok ? (response.json() as Promise<UserContentStatus>) : null))
        .then((body) => body && !cancelled && setStatus(body))
        .catch(() => {
          // Keep the last known status while the server is unreachable.
        });
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return status;
}

/** How many of a machine's files and skills wait for the user's approval. */
export function waitingCount(machine: UserContentMachineStatus): number {
  const result = machine.result;
  if (!result) return 0;
  return result.instructionFiles.filter((file) => file.state === "conflict").length + result.skills.conflicts.length;
}

/** Hand the setup to a session the user picked; Takode sends it a prompt that names the setup skill. */
export async function askSessionToSetUp(sessionId: string): Promise<void> {
  const response = await fetch("/api/user-content/agent-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }
}

/** Set by the one-time notice so the section scrolls itself into view once Settings has rendered it. */
let focusRequested = false;

export const USER_CONTENT_FOCUS_EVENT = "takode:user-content-focus";

export function requestUserContentFocus(): void {
  focusRequested = true;
  // A section that is already on screen (Settings was open) hears this instead of waiting for a mount.
  window.dispatchEvent(new Event(USER_CONTENT_FOCUS_EVENT));
}

/** Whether the notice asked for the section; asking clears the request. */
export function takeUserContentFocusRequest(): boolean {
  const requested = focusRequested;
  focusRequested = false;
  return requested;
}

/** Whether the app should show the one-time notice about setting this up. */
export function useUserContentNotice(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user-content/notice")
      .then((response) => (response.ok ? (response.json() as Promise<{ show: boolean }>) : { show: false }))
      .then((body) => !cancelled && setShow(body.show))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return {
    show,
    dismiss: () => {
      setShow(false);
      void fetch("/api/user-content/notice/dismiss", { method: "POST" });
    },
  };
}
