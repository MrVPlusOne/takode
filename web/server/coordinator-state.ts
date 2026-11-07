/**
 * The coordinator's own durable state: what a Takode server keeps under
 * `~/.companion` for every session and machine it serves, as opposed to
 * machine-local state (logs, leases, worktree checkouts, agent working files).
 *
 * A coordinator handoff (`coordinator-handoff.ts`) moves all of it to another
 * machine, and backups (`backup/backup-snapshot.ts`) keep it off the machine,
 * so adding a store here makes both carry it. Paths are relative to
 * `.companion`. Settings, sessions and memory repos are handled by each
 * caller, because they are rewritten or copied in parts.
 */

/** Folders and files shared by the whole server. */
export const COORDINATOR_SHARED_STATE = [
  "questmaster",
  "questmaster-live",
  "quest-evidence",
  "todos",
  "cron",
  "streams",
  "envs",
  "bundles",
  "user-instructions",
  "user-skills",
] as const;

/** Per-server files, named by the server's identity. */
export function coordinatorServerState(serverId: string): string[] {
  return [
    `browser-login/${serverId}.json`,
    `landing-gates/${serverId}.json`,
    `landing-queue/${serverId}.json`,
    `work-tracks/${serverId}.json`,
    `tree-groups/${serverId}.json`,
    `new-session-defaults/${serverId}.json`,
    "session-names.json",
  ];
}
