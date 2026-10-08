#!/usr/bin/env bun
/**
 * Hand the Takode coordinator from this machine to another one, or take it back.
 *
 * On the departing machine, with its Takode server stopped (a normal stop also
 * ends its own takode node):
 *   bun scripts/coordinator-handoff.ts export --to <machine> --address <url> --package-dir <empty dir>
 * This writes the package, a token file for this machine's `takode node`, and
 * a fence that keeps the server from starting here again. With `--rehearsal`
 * it leaves the running server alone and packages a copy that runs no agents.
 *
 * On the receiving machine, with no Takode server running for it:
 *   bun scripts/coordinator-handoff.ts import --package-dir <dir> [--port <n>] [--check] [--replace-existing]
 * Run it under another HOME (and `--port`) for a rehearsal next to live data.
 *
 * Back on the departing machine, to run the coordinator there again after
 * stopping it on the other machine:
 *   bun scripts/coordinator-handoff.ts reclaim [--after-epoch <n>]
 * `<n>` is the `epoch` in `~/.companion/coordinator/<serverId>.json` on the
 * other machine; hosts that followed the coordinator there refuse a lower one.
 *
 * `--port` names the server's port on this machine (default 3456).
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  exportCoordinatorHandoff,
  importCoordinatorHandoff,
  type HandoffManifest,
} from "../web/server/coordinator-handoff.ts";
import { coordinatorLockPath, coordinatorMovePath, reclaimCoordinator } from "../web/server/coordinator-lock.ts";

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((arg) => arg.startsWith("--")));

function option(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`);
  const value = index === -1 ? undefined : rest[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function port(): number {
  const value = Number(option("port") ?? 3456);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) throw new Error("--port must be a port number");
  return value;
}

function printSummary(manifest: HandoffManifest): void {
  const { summary } = manifest;
  const sessions = summary.sessions;
  console.log(`Server ${manifest.serverId} (${manifest.serverSlug}), ${manifest.fromMachine} -> ${manifest.toMachine}`);
  console.log(
    `Sessions: ${sessions.moved} moved (${sessions.toFromHost} on ${manifest.fromMachine}, ` +
      `${sessions.toCoordinator} on ${manifest.toMachine}, ${sessions.onOtherHosts} on other hosts), ` +
      `${sessions.archivedLeft} archived left behind; new sessions start at #${summary.nextSessionNumber}`,
  );
  console.log(`Timers: ${summary.timers} sessions' timer files`);
  for (const repo of summary.memoryRepos) {
    console.log(`Memory ${repo.name}: ${repo.head ?? "no commits"}${repo.remote ? ` (origin ${repo.remote})` : ""}`);
  }
  console.log(
    `Files: ${summary.files}, ${(summary.bytes / 1024 / 1024).toFixed(1)} MiB; coordinator epoch ${manifest.epoch}`,
  );
  for (const note of summary.notes) console.log(`Note: ${note}`);
}

async function main(): Promise<void> {
  if (command === "export") {
    const result = await exportCoordinatorHandoff({
      port: port(),
      packageDir: required("package-dir"),
      toMachine: required("to"),
      toAddress: required("address"),
      rehearsal: flags.has("--rehearsal"),
    });
    printSummary(result.manifest);
    if (result.manifest.rehearsal) {
      console.log("Rehearsal package written; this server was left running and unfenced.");
      return;
    }
    console.log(`\nThis machine is fenced: its Takode server for ${result.manifest.serverId} will not start here.`);
    console.log(`Its takode node token: ${result.nodeTokenFile}`);
    console.log(`Start the node once the coordinator runs on ${result.manifest.toMachine}:`);
    console.log(`  bun web/bin/takode-node.ts --coordinator <coordinator URL> --token-file ${result.nodeTokenFile}`);
  } else if (command === "import") {
    const result = await importCoordinatorHandoff({
      port: option("port") ? port() : undefined,
      packageDir: required("package-dir"),
      checkOnly: flags.has("--check"),
      replaceExisting: flags.has("--replace-existing"),
    });
    printSummary(result.manifest);
    console.log("Every file matches its checksum.");
    for (const path of result.replaced) console.log(`${result.applied ? "Replaced" : "Would replace"}: ${path}`);
    if (result.backupDir) console.log(`Replaced files were moved to ${result.backupDir}`);
    console.log(result.applied ? "Imported. Start the Takode server here." : "Checked only; nothing was written.");
  } else if (command === "reclaim") {
    const settings = JSON.parse(await readFile(join(homedir(), ".companion", `settings-${port()}.json`), "utf-8"));
    const afterEpoch = option("after-epoch") ? Number(option("after-epoch")) : undefined;
    if (afterEpoch !== undefined && !Number.isInteger(afterEpoch)) throw new Error("--after-epoch must be a number");
    const { wasMoved } = await reclaimCoordinator({
      lockPath: coordinatorLockPath(settings.serverId),
      movePath: coordinatorMovePath(settings.serverId),
      afterEpoch,
    });
    console.log(wasMoved ? "The fence is removed; the server can start here again." : "This server was not fenced.");
  } else {
    console.log("Usage: bun scripts/coordinator-handoff.ts <export|import|reclaim> [options] (see the file header)");
    process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
