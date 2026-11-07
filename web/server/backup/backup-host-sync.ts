/**
 * Keeps a copy of the backup in a Git repository on another machine with a
 * `takode node`, such as the user's laptop. The machine pulls: through the
 * host link the server starts a `git fetch` there, which reaches the backup
 * clone on the coordinator through the node's API proxy
 * (`backup-git-server.ts`), so no new connection or credential is needed
 * beyond a token that opens that one path for the length of one sync.
 *
 * The fetch never forces, so the copy refuses history that was rewritten on
 * the coordinator and keeps what it had. A machine that is offline is simply
 * synced when it is back.
 */

import { LOCAL_HOST_ID } from "../../shared/host-protocol.js";
import { LOGIN_SHELL_SCRIPT } from "../remote-host/host-exec.js";
import type { HostLinkManager } from "../remote-host/host-link-manager.js";
import { BACKUP_GIT_PATH } from "./backup-git-server.js";

export interface HostCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs commands on machines with a node; the server's is {@link hostLinkRunner}. */
export interface HostRunner {
  /** Why the machine cannot run a command now (such as "is offline"), or null when it can. */
  blocker(hostId: string): string | null;
  /** Run a `/bin/sh` script in the machine user's login environment and wait for it to end. */
  run(hostId: string, script: string, env: Record<string, string>, timeoutMs: number): Promise<HostCommandResult>;
}

export type HostSyncResult = { ok: true } | { ok: false; error: string };

/** How long one sync may take; the first one carries the whole backup through the machine's tunnel. */
const SYNC_TIMEOUT_MS = 3 * 60 * 60_000;

/**
 * Runs on the machine with `TAKODE_BACKUP_PATH` naming its repository (a
 * leading `~` is its home), creates the repository when the folder is new or
 * empty, fetches every backup branch without forcing, and prints the branch
 * heads it then has. No single quotes: it is passed inside them.
 */
const FETCH_SCRIPT = [
  "set -e",
  'repo="$TAKODE_BACKUP_PATH"',
  'case "$repo" in "~") repo="$HOME" ;; "~/"*) repo="$HOME/${repo#"~/"}" ;; esac',
  'mkdir -p "$repo"',
  'if [ -f "$repo/HEAD" ] && [ -d "$repo/objects" ]; then :',
  'elif [ -z "$(ls -A "$repo")" ]; then git init -q --bare "$repo"',
  'else echo "$repo is neither empty nor a bare Git repository" >&2; exit 3; fi',
  `git -C "$repo" fetch -q --no-tags "http://127.0.0.1:$COMPANION_PORT${BACKUP_GIT_PATH}/repo" "refs/heads/takode/*:refs/heads/takode/*"`,
  'git -C "$repo" for-each-ref --format="%(objectname) %(refname)" refs/heads/takode/',
].join("\n");

/**
 * Bring the copy on `hostId` up to date with `localHeads` (the backup clone's
 * `takode/` branches by full ref name) and check that it holds exactly those
 * commits afterwards. `token` must open the backup's Git path for this sync.
 */
export async function syncHostCopy(input: {
  runner: HostRunner;
  hostId: string;
  path: string;
  token: string;
  localHeads: Map<string, string>;
}): Promise<HostSyncResult> {
  const result = await input.runner.run(
    input.hostId,
    FETCH_SCRIPT,
    {
      TAKODE_BACKUP_PATH: input.path,
      // Git config from the environment keeps the token out of the command line.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${input.token}`,
      GIT_TERMINAL_PROMPT: "0",
    },
    SYNC_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").slice(-3).join(" ") || `exit code ${result.code}`;
    return { ok: false, error: `fetching into ${input.path} failed: ${detail}` };
  }
  const remote = new Map<string, string>();
  for (const line of result.stdout.trim().split("\n")) {
    const [sha, ref] = line.trim().split(" ");
    if (sha && ref) remote.set(ref, sha);
  }
  const missing = [...input.localHeads].filter(([ref, sha]) => remote.get(ref) !== sha).map(([ref]) => ref);
  if (missing.length > 0) {
    return { ok: false, error: `the copy in ${input.path} does not match the backup on ${missing.join(", ")}` };
  }
  return { ok: true };
}

/** A {@link HostRunner} over the server's host links, running scripts like `takode exec` does. */
export function hostLinkRunner(links: HostLinkManager): HostRunner {
  return {
    blocker: (hostId) => (hostId === LOCAL_HOST_ID ? "is this machine" : links.startBlocker(hostId)),
    run: (hostId, script, env, timeoutMs) =>
      new Promise((resolve) => {
        const proc = links.spawn(hostId, {
          command: "/bin/sh",
          args: ["-c", LOGIN_SHELL_SCRIPT, "takode-backup", `/bin/sh -c '${script}'`, ""],
          env,
          group: true,
        });
        proc.stdin.end();
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
        proc.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf-8")).slice(-8000)));
        proc.on("error", (error: Error) => (stderr += `\n${error.message}`));
        const timer = setTimeout(() => {
          stderr += `\nstopped after ${Math.round(timeoutMs / 60_000)} minutes`;
          proc.kill("SIGKILL");
        }, timeoutMs);
        proc.once("exit", (code: number | null) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      }),
  };
}
