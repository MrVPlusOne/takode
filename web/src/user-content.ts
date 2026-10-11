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
      conflicts: string[];
      takenOver: string[];
    };
    notes: string[];
  };
}

export interface UserContentStatus {
  storeRoot: string;
  storeExists: boolean;
  storeEmpty: boolean;
  machines: UserContentMachineStatus[];
}

const POLL_MS = 10_000;

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
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return { status, refresh };
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

/** What on a machine waits for the user's approval, one line each; empty when nothing does. */
export function pendingApprovals(machine: UserContentMachineStatus): string[] {
  const result = machine.result;
  if (!result) return [];
  return [
    ...result.instructionFiles
      .filter((file) => file.state === "conflict")
      .map((file) => `${file.path}${file.detail ? ` (${file.detail})` : ""}`),
    ...result.skills.conflicts,
  ];
}
