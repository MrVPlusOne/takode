import { useEffect, useState } from "react";

/** One machine's last delivery of the user's instructions and skills (see server/user-content-install.ts). */
export interface UserContentMachineStatus {
  /** Null for this server's own machine. */
  hostId: string | null;
  at: number;
  error?: string;
  result?: {
    status: string;
    instructionFiles: { backend: string; path: string; state: string; detail?: string; backup?: string }[];
    skills: {
      linked: string[];
      removed: string[];
      shadowedByTakode: string[];
      conflicts: { path: string; detail: string }[];
      takenOver: string[];
    };
    notes: string[];
    backupDir?: string;
  };
  /** Where this machine's most recent backup went. */
  lastBackup?: { dir: string; at: number };
}

/** What an import from one machine would bring in (server/user-content.ts `UserLevelSummary`). */
export interface UserLevelSummary {
  claudeChars: number;
  codexChars: number;
  sharedInstructions: boolean;
  skills: string[];
}

export interface UserContentStatus {
  store: { instructions: string; skills: string };
  storeExists: boolean;
  storeEmpty: boolean;
  machines: UserContentMachineStatus[];
  importCandidates: { hostId: string | null; summary?: UserLevelSummary; error?: string; pending?: boolean }[];
}

const POLL_MS = 10_000;
/** While machines are still being read, poll quickly so each preview appears soon after it is ready. */
const PENDING_POLL_MS = 1_500;

/** The server's user content status, refreshed while the caller is mounted. */
export function useUserContentStatus(): { status: UserContentStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<UserContentStatus | null>(null);
  async function refresh() {
    try {
      const response = await fetch("/api/user-content");
      if (response.ok) setStatus((await response.json()) as UserContentStatus);
    } catch {
      // Keep the last known status while the server is unreachable.
    }
  }
  const pending = status?.importCandidates.some((candidate) => candidate.pending) ?? false;
  useEffect(() => {
    if (status === null) void refresh();
    const timer = setInterval(() => void refresh(), pending ? PENDING_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [pending]);
  return { status, refresh };
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

async function post(path: string, hostId: string | null): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }
}

/** Fill the empty store from one machine's files, then let Takode manage that machine's files. */
export function importUserContent(hostId: string | null): Promise<void> {
  return post("/api/user-content/import", hostId);
}

/** Replace the user's own files and skills on one machine with the store's (each is backed up). */
export function takeOverUserContent(hostId: string | null): Promise<void> {
  return post("/api/user-content/take-over", hostId);
}

/** What on a machine waits for the user's approval, with why; empty when nothing does. */
export function pendingApprovals(machine: UserContentMachineStatus): { path: string; detail: string }[] {
  const result = machine.result;
  if (!result) return [];
  return [
    ...result.instructionFiles
      .filter((file) => file.state === "conflict")
      .map((file) => ({ path: file.path, detail: file.detail ?? "" })),
    ...result.skills.conflicts,
  ];
}

/** One line describing what an import from a machine would bring in. */
export function describeImport(summary: UserLevelSummary): string {
  const kb = (chars: number) => `${Math.max(1, Math.round(chars / 1024))} KB`;
  const rules = summary.sharedInstructions
    ? `rules ${kb(summary.claudeChars)} (one file for Claude and Codex)`
    : [
        summary.claudeChars ? `Claude rules ${kb(summary.claudeChars)}` : "",
        summary.codexChars ? `Codex rules ${kb(summary.codexChars)}` : "",
      ]
        .filter(Boolean)
        .join(", ") || "no rules";
  const count = summary.skills.length;
  return `${rules}; ${count === 0 ? "no skills" : `${count} skill${count === 1 ? "" : "s"}: ${summary.skills.join(", ")}`}`;
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
