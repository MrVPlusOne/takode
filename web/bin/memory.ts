#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { workstreamMemoryService } from "../server/workstream-memory-service.js";
import { applyMemoryHandle, noteViewLine, type MemoryViewLine } from "../server/memory-catalog-view.js";
import { memoryHealthSummary } from "../server/memory-repo-health.js";
import { parseMovePlan } from "../server/memory-move.js";
import { getServerSlug, initWithPort } from "../server/settings-manager.js";
import {
  MEMORY_COMMIT_OPERATIONS,
  MEMORY_DESCRIPTION_CHAR_LIMIT,
  MEMORY_NOTE_TYPES,
  type MemoryCommitOperation,
} from "../server/workstream-memory-types.js";

const VALUE_OPTIONS = new Set(["--root", "--server-id", "--server-slug", "--session-space"]);
/** Flags that never take a value, so the next token stays positional. */
const BOOLEAN_FLAGS = new Set(["--json", "--all", "--no-steal-stale", "--help"]);
const args = process.argv.slice(2);
const commandIndex = findCommandIndex(args);
const command = commandIndex === -1 ? undefined : args[commandIndex];
const jsonOutput = flag("json");

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function findCommandIndex(tokens: string[]): number {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith("--")) return index;
    if (VALUE_OPTIONS.has(token) && tokens[index + 1] && !tokens[index + 1].startsWith("--")) index += 1;
  }
  return -1;
}

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  return undefined;
}

function options(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === `--${name}` && args[index + 1] && !args[index + 1].startsWith("--")) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function positional(index: number): string | undefined {
  let current = 0;
  const start = commandIndex === -1 ? 0 : commandIndex + 1;
  for (let i = start; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!BOOLEAN_FLAGS.has(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
      continue;
    }
    if (current === index) return args[i];
    current += 1;
  }
  return undefined;
}

function positionals(): string[] {
  const values: string[] = [];
  for (let index = 0; ; index++) {
    const value = positional(index);
    if (value === undefined) return values;
    values.push(value);
  }
}

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printUsage(): void {
  console.log(`Usage: memory [options] <command> [args]

Memory is a Git repo of Markdown notes in topic folders. Load the \`memory\` skill before
writing, moving or reorganizing notes; it has the full workflow and the curation procedure.

Reading:
  catalog show [--seen HANDLE]
      The catalog: recently updated notes plus one line per top-level folder.
  catalog show <folder> [--seen HANDLE]
      Every note in one folder. Before relying on memory, list every folder that matches your task.
  catalog show --all [--seen HANDLE]
      Every note in the repo (for curation).
  catalog diff [--seen HANDLE]
      Notes whose content changed since this session last looked.
  Every catalog output ends with a memory handle. Pass the newest handle with --seen on your next
  read to leave out entries already shown (they are counted, not listed). Without --seen the output
  is complete. --json prints full machine-readable fields without dedupe.
  helpful <path>...
      Record that notes helped. A mark counts as touching the note for the recent list.
  repo path
      Print the resolved repo root.

Writing (hold the lock):
  lock status|acquire|release [--owner NAME] [--ttl-ms N]
  mv <old-path> <new-path> | mv --plan <file>
      Move notes and rewrite every reference to them. A plan has one "old new" pair per line.
  lint
      Health check: summary line, then errors and warnings. Commits are blocked only by errors.
  status | diff
      Pending Git changes.
  commit --message TEXT [--quest q-N] [--session N] [--operation update|repair|...] [--memory-id PATH] [--source REF]
      Commit with provenance trailers. Stamps \`updated:\` on changed notes unless --operation repair
      (use repair for moves, README edits and description fixes).

Options:
  --root PATH            Override the memory repo root for this command.
  --server-slug SLUG     Override the server slug used for default repo discovery.
  --session-space SLUG   Override the session-space slug used for default repo discovery.
  --json                 Machine-readable output.

Default repo: ~/.companion/memory/<serverSlug>/<sessionSpace>, auto-created with Git.

Note frontmatter:
  description: "Read when/before/for ..." routing line, at most ${MEMORY_DESCRIPTION_CHAR_LIMIT} characters
  type: one of ${MEMORY_NOTE_TYPES.join(", ")}
  updated: YYYY-MM-DD (stamped by memory commit)
  source: [q-N]   (quest ID for quest-backed notes; session:<id> only without a quest)
Notes live in topic folders (5-25 notes each), each with a README.md holding a one-line description.

Write flow:
  memory lock acquire --owner <session-or-role>
  edit Markdown files directly (move notes only with memory mv)
  memory lint
  memory diff
  memory commit --message "Update memory" --source <source-ref> --memory-id <repo-relative-path>
  memory lock release`);
}

function repoOptions() {
  return {
    root: option("root"),
    serverId: option("server-id"),
    serverSlug: option("server-slug"),
    sessionSpaceSlug: option("session-space"),
  };
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePositiveInt(raw: string | undefined, label: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) die(`${label} must be a positive integer`);
  return parsed;
}

function parseOperation(raw: string | undefined): MemoryCommitOperation | undefined {
  if (!raw) return undefined;
  if (MEMORY_COMMIT_OPERATIONS.includes(raw as MemoryCommitOperation)) return raw as MemoryCommitOperation;
  die(`--operation must be one of: ${MEMORY_COMMIT_OPERATIONS.join(", ")}`);
}

function requireOption(name: string): string {
  const value = option(name);
  if (!value?.trim()) die(`--${name} is required`);
  return value.trim();
}

function printCatalogJson(catalog: Awaited<ReturnType<typeof workstreamMemoryService.catalog>>): void {
  out({ repo: catalog.repo, entries: catalog.entries, folders: catalog.folders, issues: catalog.issues });
}

async function printCatalogDiff(diff: Awaited<ReturnType<typeof workstreamMemoryService.catalogDiff>>): Promise<void> {
  if (jsonOutput) {
    out(diff);
    return;
  }
  // Versions must match catalog outputs so a later listing can skip what diff already showed.
  const hashes = (await workstreamMemoryService.catalog(repoOptions())).contentHashes ?? {};
  const lines: MemoryViewLine[] = [{ text: `Memory repo: ${diff.repo.root}` }];
  lines.push({
    text: diff.previousSeenAt
      ? `Catalog changes since ${diff.previousSeenAt}:`
      : "No prior catalog snapshot for this session; current entries are shown as new:",
  });
  if (!diff.changes.length) lines.push({ text: "No catalog changes since last seen." });
  for (const change of diff.changes) {
    const entry = change.after ?? change.before;
    const description = entry?.description ? ` ${entry.description}` : "";
    const text = `${change.kind}: ${change.path}${description}`;
    // A changed note's new version is now shown; record it so later reads can skip it.
    lines.push(change.after ? { ...noteViewLine(change.after, hashes[change.path]), text } : { text });
  }
  const view = await applyMemoryHandle(diff.repo.root, lines, { seen: option("seen") });
  console.log(view.text);
}

function printIssues(issues: { severity: string; path?: string; message: string }[]): void {
  if (!issues.length) return;
  console.log("\nIssues:");
  for (const issue of issues) {
    const path = issue.path ? `${issue.path}: ` : "";
    console.log(`  ${issue.severity}: ${path}${issue.message}`);
  }
}

async function main(): Promise<void> {
  await scopeSettingsFromEnv();

  if (!command || flag("help") || command === "help") {
    printUsage();
    return;
  }

  if (command === "repo") {
    const subcommand = positional(0) ?? "path";
    if (subcommand === "path") {
      const repo = workstreamMemoryService.resolveRepo(repoOptions());
      if (jsonOutput) out(repo);
      else console.log(repo.root);
      return;
    }
    die("repo subcommand must be path");
  }

  if (command === "catalog") {
    const subcommand = positional(0);
    if (subcommand === "diff") {
      await printCatalogDiff(await workstreamMemoryService.catalogDiff(repoOptions()));
      return;
    }
    if (subcommand && subcommand !== "show") die("catalog subcommand must be show or diff");
    const folder = positional(1);
    if (jsonOutput) {
      const catalog = await workstreamMemoryService.catalog(repoOptions());
      printCatalogJson(catalog);
      if (!folder) await workstreamMemoryService.markCatalogSeen(catalog);
      return;
    }
    const request = folder
      ? ({ mode: "folder", folder } as const)
      : flag("all")
        ? ({ mode: "all" } as const)
        : ({ mode: "overview" } as const);
    const { catalog, view } = await workstreamMemoryService.catalogView(request, repoOptions(), option("seen"));
    console.log(view.text);
    if (!folder) await workstreamMemoryService.markCatalogSeen(catalog);
    return;
  }

  if (command === "helpful") {
    const paths = positionals();
    if (!paths.length) die("helpful needs at least one repo-relative note path");
    const result = await workstreamMemoryService.markHelpful(paths, repoOptions());
    if (jsonOutput) out(result);
    else console.log(`Marked ${result.marked.length} note(s) helpful on ${result.date}.`);
    return;
  }

  if (command === "mv") {
    const planPath = option("plan");
    const moves = planPath
      ? parseMovePlan(await readFile(planPath, "utf-8"))
      : (() => {
          const [from, to] = positionals();
          if (!from || !to) die("mv needs <old-path> <new-path>, or --plan <file>");
          return [{ from, to }];
        })();
    const result = await workstreamMemoryService.move(moves, repoOptions());
    if (jsonOutput) out(result);
    else
      console.log(
        `Moved ${result.moved} note(s); rewrote references in ${result.rewrittenNotes} other note(s). Commit with --operation repair.`,
      );
    return;
  }

  if (command === "lint" || command === "doctor") {
    const catalog = await workstreamMemoryService.lint(repoOptions());
    const errors = catalog.issues.filter((issue) => issue.severity === "error").length;
    if (jsonOutput) {
      out({ ok: !errors, repo: catalog.repo, entries: catalog.entries, issues: catalog.issues });
      if (errors) process.exit(1);
      return;
    }
    console.log(await memoryHealthSummary(catalog));
    printIssues(catalog.issues);
    const warnings = catalog.issues.filter((issue) => issue.severity === "warning").length;
    console.log(
      errors || warnings ? `Memory lint found ${errors} errors and ${warnings} warnings.` : "Memory lint passed.",
    );
    if (errors) process.exit(1);
    return;
  }

  if (command === "lock") {
    const subcommand = positional(0) ?? "status";
    if (subcommand === "status") {
      const status = await workstreamMemoryService.lockStatus(repoOptions());
      if (jsonOutput) out(status);
      else console.log(status.locked ? `locked: ${status.owner ?? "unknown"} ${status.expiresAt ?? ""}` : "unlocked");
      return;
    }
    if (subcommand === "acquire") {
      const status = await workstreamMemoryService.acquireLock({
        ...repoOptions(),
        owner: option("owner"),
        ttlMs: parsePositiveInt(option("ttl-ms"), "--ttl-ms"),
        stealStale: !flag("no-steal-stale"),
      });
      if (jsonOutput) out(status);
      else console.log(`locked: ${status.lockPath}`);
      return;
    }
    if (subcommand === "release") {
      const status = await workstreamMemoryService.releaseLock(repoOptions());
      if (jsonOutput) out(status);
      else console.log("unlocked");
      return;
    }
    die("lock subcommand must be status, acquire, or release");
  }

  if (command === "status") {
    const status = await workstreamMemoryService.gitStatus(repoOptions());
    if (jsonOutput) out({ status });
    else console.log(status || "clean");
    return;
  }

  if (command === "diff") {
    console.log(await workstreamMemoryService.gitDiff(repoOptions()));
    return;
  }

  if (command === "commit") {
    const lock = await workstreamMemoryService.lockStatus(repoOptions());
    if (!lock.locked || lock.stale) die("Acquire the memory repo lock before committing memory changes.");
    const operation = parseOperation(option("operation"));
    const result = await workstreamMemoryService.commit({
      ...repoOptions(),
      message: requireOption("message"),
      quest: option("quest"),
      session: option("session"),
      operation,
      memoryIds: [...options("memory-id"), ...parseCsv(option("memory-ids"))],
      sources: [...options("source"), ...parseCsv(option("sources"))],
    });
    if (jsonOutput) out(result);
    else console.log(result.committed ? `committed ${result.sha}` : result.message);
    return;
  }

  console.error(`Error: Unknown memory command: ${command}`);
  printUsage();
  process.exit(1);
}

async function scopeSettingsFromEnv(): Promise<void> {
  const port = Number(process.env.COMPANION_PORT);
  if (!Number.isInteger(port) || port <= 0) return;
  await initWithPort(port);
  if (!option("server-slug")) {
    process.env.COMPANION_SERVER_SLUG = getServerSlug();
  }
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
