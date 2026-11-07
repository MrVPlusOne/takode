/**
 * `takode backup`: the backups of this server's data to destinations the user
 * picked, a Git repository URL and/or a repository on one of their machines
 * (see docs/backups.md). Everything but `restore` goes through the
 * server, which runs the backups; `restore` works without a server, because it
 * is what you run when the coordinator's data is gone.
 */

import { resolve } from "node:path";
import type { BackupStatus } from "../shared/backup-status.js";
import { restoreFromBackup } from "../server/backup/backup-job.js";
import { takodeOptionalAuthHeaders } from "./takode-core.js";

export const BACKUP_USAGE =
  "Usage: takode backup status [--json] | set-repo <git-url> | set-machine <machine> <folder> | " +
  "off [--repo | --machine] | run | test | " +
  "restore --repo <git-url> --to <empty folder> [--slug <server slug>]";

export async function handleBackup(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "status":
    case undefined:
      return printStatus((await request(base, "GET", "/backup")) as BackupStatus, rest.includes("--json"));
    case "set-repo": {
      const repoUrl = rest[0];
      if (!repoUrl) throw new Error(BACKUP_USAGE);
      printStatus((await request(base, "PUT", "/backup", { repoUrl })) as BackupStatus, false);
      console.log("\nA backup has started; run takode backup status to follow it.");
      return;
    }
    case "set-machine": {
      const [name, path] = rest;
      if (!name || !path) throw new Error(BACKUP_USAGE);
      const { hosts } = (await request(base, "GET", "/hosts")) as { hosts: Array<{ id: string; name: string }> };
      const host = hosts.find((candidate) => candidate.name === name || candidate.id === name);
      if (!host) throw new Error(`No registered machine named ${name}; see takode host list`);
      printStatus((await request(base, "PUT", "/backup", { host: { hostId: host.id, path } })) as BackupStatus, false);
      console.log(`\nA backup has started; ${host.name} gets its copy once it is online.`);
      return;
    }
    case "off": {
      const which = rest.includes("--repo") ? { repoUrl: "" } : rest.includes("--machine") ? { host: null } : null;
      await request(base, "PUT", "/backup", which ?? { repoUrl: "", host: null });
      console.log(
        which
          ? "That destination is off. Its existing copy is left as it is."
          : "Backups are off. Existing copies and this machine's clone are left as they are.",
      );
      return;
    }
    case "run":
    case "test":
      await request(base, "POST", subcommand === "run" ? "/backup/run" : "/backup/test");
      console.log(
        `${subcommand === "run" ? "Backup" : "Restore test"} started; run takode backup status to follow it.`,
      );
      return;
    case "restore":
      return restore(rest);
    default:
      throw new Error(BACKUP_USAGE);
  }
}

async function restore(args: string[]): Promise<void> {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const repoUrl = option("--repo");
  const to = option("--to");
  if (!repoUrl || !to) throw new Error(BACKUP_USAGE);
  const target = resolve(to);
  const result = await restoreFromBackup({ repoUrl, target, serverSlug: option("--slug") });
  console.log(
    [
      `Restored the backup of server ${result.serverSlug} written ${result.snapshotAt} into ${target}:`,
      `  ${result.files} files, ${result.quests} quests, memory spaces: ${result.memory.join(", ") || "none"}.`,
      "",
      'Nothing live was touched. To use it, follow "Restore" in docs/backups.md: stop the Takode',
      "server, move the current ~/.companion aside, move this folder into its place, start the server,",
      "and re-enter the secrets backups leave out (API keys, Pushover keys, env profiles, login password).",
    ].join("\n"),
  );
}

function printStatus(status: BackupStatus, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (!status.repoUrl && !status.host) {
    console.log(
      "Backups are off: no destination is set (takode backup set-repo <git-url> or set-machine <machine> <folder>).",
    );
    return;
  }
  const lines: string[] = [];
  if (status.repoUrl) lines.push(`Repository: ${status.repoUrl}`);
  if (status.host) lines.push(`Machine copy: ${status.hostName ?? status.host.hostId}:${status.host.path}`);
  if (status.running) lines.push(`Running now: ${RUNNING[status.running]}`);
  const run = status.lastRun;
  if (run) {
    const result = run.ok
      ? `succeeded${run.changed ? ` (${run.quests} quests)` : ", nothing had changed"}`
      : `FAILED: ${run.errors.join("; ")}`;
    lines.push(`Last backup: ${when(run.startedAt)}, ${result}`);
  } else {
    lines.push("Last backup: none yet");
  }
  if (status.consecutiveFailures > 0) {
    const success = status.lastSuccessAt ? `last success ${when(status.lastSuccessAt)}` : "never succeeded";
    lines.push(`Failures in a row: ${status.consecutiveFailures} (${success})`);
  }
  const sync = status.hostSync;
  if (status.host) {
    const synced = sync?.lastSuccessAt ? `last synced ${when(sync.lastSuccessAt)}` : "not synced yet";
    const state = sync?.error ? `FAILED: ${sync.error}` : sync?.waiting ? `waiting: ${sync.waiting}` : "up to date";
    lines.push(`Machine copy: ${synced}; ${state}`);
  }
  const test = status.lastTest;
  lines.push(
    test
      ? `Last restore test: ${when(test.at)}, ${test.ok ? "passed" : `FAILED: ${test.problems.join("; ")}`}`
      : "Last restore test: none yet",
  );
  console.log(lines.join("\n"));
}

const RUNNING: Record<NonNullable<BackupStatus["running"]>, string> = {
  backup: "a backup",
  test: "a restore test",
  host: "a sync to the backup machine",
};

function when(at: number): string {
  return new Date(at).toLocaleString();
}

async function request(base: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: takodeOptionalAuthHeaders(body === undefined ? undefined : { "Content-Type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}
