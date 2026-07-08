#!/usr/bin/env bun
/**
 * Build or inspect a staged Takode/Companion migration package for moving
 * historical server state from a laptop to a Devbox-hosted production server.
 *
 * Dry-run inventory:
 *   bun --no-install scripts/migrate-takode-devbox.ts inventory
 *
 * Export package on the source machine:
 *   bun --no-install scripts/migrate-takode-devbox.ts export --package-dir /tmp/takode-devbox-package
 *
 * Inspect import on the target machine:
 *   bun --no-install scripts/migrate-takode-devbox.ts import --package-dir /tmp/takode-devbox-package
 *
 * Apply import after explicit approval:
 *   bun --no-install scripts/migrate-takode-devbox.ts import --package-dir /tmp/takode-devbox-package --apply --allow-overwrite
 */

import {
  buildProductionStartInstructions,
  exportDevboxMigrationPackage,
  importDevboxMigrationPackage,
  inspectDevboxMigration,
  inspectDevboxMigrationImport,
  type DevboxMigrationEntry,
  type DevboxMigrationExcludedPath,
  type DevboxMigrationOptions,
} from "../web/server/devbox-migration.ts";

const { command, options } = parseArgs(process.argv.slice(2));

try {
  if (command === "inventory") {
    const plan = await inspectDevboxMigration(options);
    console.log("Dry-run inventory. No files were changed.");
    printEntries(plan.entries);
    printExcluded(plan.excluded);
    printStart(plan.productionStart);
  } else if (command === "export") {
    const result = await exportDevboxMigrationPackage(options);
    console.log(`Migration package exported: ${result.packageDir}`);
    console.log(`Manifest: ${result.manifestPath}`);
    printEntries(result.plan.entries.filter((entry) => entry.exists));
    printExcluded(result.plan.excluded);
    printStart(result.plan.productionStart);
  } else if (command === "import") {
    const result = options.apply
      ? await importDevboxMigrationPackage(options)
      : { applied: false, plan: await inspectDevboxMigrationImport(options) };
    console.log(result.applied ? "Migration import applied." : "Dry-run import. No files were changed.");
    console.log(`Package: ${result.plan.packageDir}`);
    console.log(`Target home: ${result.plan.targetHome}`);
    console.log(`Backup dir: ${result.plan.backupDir}`);
    for (const action of result.plan.actions) {
      console.log(
        `- ${action.id}: ${action.packagePath} -> ${action.targetPath}` +
          ` (${action.targetExists ? "target exists" : "target absent"})`,
      );
    }
    if (result.plan.conflicts.length > 0) {
      console.log("\nConflicts:");
      for (const conflict of result.plan.conflicts) console.log(`- ${conflict}`);
    }
    for (const note of result.plan.notes) console.log(`Note: ${note}`);
    if ("backupManifestPath" in result && result.backupManifestPath) {
      console.log(`Backup manifest: ${result.backupManifestPath}`);
    }
  } else {
    printStart(buildProductionStartInstructions(options.targetPort));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration tool failed: ${message}`);
  process.exit(1);
}

function printEntries(entries: DevboxMigrationEntry[]): void {
  console.log("\nIncluded package entries:");
  for (const entry of entries) {
    const status = entry.exists ? `${entry.fileCount} files, ${formatBytes(entry.bytes)}` : "missing";
    console.log(`- ${entry.id} [${entry.category}]: ${entry.sourcePath} -> ${entry.targetPath} (${status})`);
    for (const note of entry.notes) console.log(`  note: ${note}`);
  }
}

function printExcluded(excluded: DevboxMigrationExcludedPath[]): void {
  console.log("\nExcluded approval-gated or host-local state:");
  for (const row of excluded) {
    console.log(`- ${row.id}: ${row.path} (${row.exists ? "exists" : "absent"}) -- ${row.reason}`);
  }
}

function printStart(start: ReturnType<typeof buildProductionStartInstructions>): void {
  console.log("\nProduction start guidance:");
  console.log(`- ${start.command}`);
  for (const note of start.serviceNotes) console.log(`  note: ${note}`);
  console.log("Validation:");
  for (const check of start.validation) console.log(`- ${check}`);
}

function parseArgs(args: string[]): {
  command: "inventory" | "export" | "import" | "start-help";
  options: DevboxMigrationOptions;
} {
  let command: "inventory" | "export" | "import" | "start-help" = "inventory";
  const options: DevboxMigrationOptions = {};
  const rest = [...args];
  if (rest[0] && !rest[0].startsWith("-")) {
    const raw = rest.shift();
    if (raw === "inventory" || raw === "export" || raw === "import" || raw === "start-help") {
      command = raw;
    } else {
      throw new Error(`Unknown command: ${raw}`);
    }
  }
  while (rest.length > 0) {
    const flag = rest.shift();
    switch (flag) {
      case "--source-home":
        options.sourceHome = requireValue(flag, rest.shift());
        break;
      case "--target-home":
        options.targetHome = requireValue(flag, rest.shift());
        break;
      case "--source-port":
        options.sourcePort = parsePort(requireValue(flag, rest.shift()));
        break;
      case "--target-port":
        options.targetPort = parsePort(requireValue(flag, rest.shift()));
        break;
      case "--package-dir":
        options.packageDir = requireValue(flag, rest.shift());
        break;
      case "--backup-root":
        options.backupRoot = requireValue(flag, rest.shift());
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--allow-overwrite":
        options.allowOverwrite = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return { command, options };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function printHelp(): void {
  console.log(`Usage: bun --no-install scripts/migrate-takode-devbox.ts <inventory|export|import|start-help> [options]

Options:
  --source-home <path>     Source ~/.companion directory (default: current user's ~/.companion)
  --target-home <path>     Target ~/.companion directory (default: current user's ~/.companion)
  --source-port <port>     Source server port (default: 3456)
  --target-port <port>     Target server port (default: 3456)
  --package-dir <path>     Migration package directory
  --backup-root <path>     Target backup root for import
  --apply                  Apply import. Import is dry-run without this flag.
  --allow-overwrite        Allow import over existing target paths; backups are written first.
`);
}
