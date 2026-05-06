#!/usr/bin/env bun

import { workstreamMemoryService } from "../server/workstream-memory-service.js";
import {
  MEMORY_COMMIT_OPERATIONS,
  MEMORY_KINDS,
  type MemoryCommitOperation,
  type MemoryKind,
} from "../server/workstream-memory-types.js";

const args = process.argv.slice(2);
const command = args[0];
const jsonOutput = flag("json");

function flag(name: string): boolean {
  return args.includes(`--${name}`);
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
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
      continue;
    }
    if (current === index) return args[i];
    current += 1;
  }
  return undefined;
}

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printUsage(): void {
  console.log(`Usage: memory <command> [args]

Commands:
  repo path|init
  catalog [--json]
  recall [query] [--kind current,knowledge] [--facet key:value] [--content] [--limit N] [--json]
  lint|doctor [--json]
  lock status|acquire|release [--owner NAME] [--ttl-ms N] [--json]
  status [--json]
  diff
  commit --message TEXT [--quest q-N] [--session N] [--operation update] [--memory-id ID] [--source REF] [--json]
  migrate preview

Options:
  --root PATH       Override the memory repo root for this command.
  --server-id ID    Override the server/session-space id used for default repo discovery.

Memory files are authored directly under:
  current/ knowledge/ procedures/ decisions/ references/ artifacts/

The old workstream/upsert/check authoring model is intentionally replaced.`);
}

function repoOptions() {
  return {
    root: option("root"),
    serverId: option("server-id"),
  };
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseKinds(): MemoryKind[] | undefined {
  const raw = [...options("kind"), ...parseCsv(option("kinds"))].flatMap((item) => parseCsv(item));
  if (!raw.length) return undefined;
  const kinds: MemoryKind[] = [];
  for (const value of raw) {
    if (!MEMORY_KINDS.includes(value as MemoryKind)) {
      die(`--kind must be one of: ${MEMORY_KINDS.join(", ")}`);
    }
    kinds.push(value as MemoryKind);
  }
  return kinds;
}

function parseFacets(): Record<string, string[]> | undefined {
  const values = [...options("facet"), ...parseCsv(option("facets"))];
  if (!values.length) return undefined;
  const facets: Record<string, string[]> = {};
  for (const token of values) {
    const [key, value] = token.split(":", 2);
    if (!key?.trim() || !value?.trim()) die(`Invalid --facet token: ${token}`);
    facets[key.trim()] = [...(facets[key.trim()] ?? []), value.trim()];
  }
  return facets;
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

function printCatalog(catalog: Awaited<ReturnType<typeof workstreamMemoryService.catalog>>): void {
  if (jsonOutput) {
    out(catalog);
    return;
  }
  console.log(`Memory repo: ${catalog.repo.root}`);
  if (!catalog.entries.length) {
    console.log("No memory files found.");
  }
  for (const entry of catalog.entries) {
    console.log(`${entry.id} [${entry.kind}] ${entry.title} (${entry.path})`);
    for (const summary of entry.summary) console.log(`  ${summary}`);
  }
  printIssues(catalog.issues);
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
  if (!command || flag("help") || command === "help") {
    printUsage();
    return;
  }

  if (["workstream", "current", "upsert", "retire", "check", "bookkeeping", "grep", "show"].includes(command)) {
    die(
      "The old workstream-memory CLI was superseded. Edit memory Markdown files directly, then use memory catalog/recall/lint/lock/commit.",
    );
  }

  if (command === "repo") {
    const subcommand = positional(0) ?? "path";
    if (subcommand === "path") {
      const repo = workstreamMemoryService.resolveRepo(repoOptions());
      if (jsonOutput) out(repo);
      else console.log(repo.root);
      return;
    }
    if (subcommand === "init") {
      const repo = await workstreamMemoryService.ensureRepo(repoOptions());
      if (jsonOutput) out(repo);
      else console.log(`Initialized memory repo at ${repo.root}`);
      return;
    }
    die("repo subcommand must be path or init");
  }

  if (command === "catalog") {
    printCatalog(await workstreamMemoryService.catalog(repoOptions()));
    return;
  }

  if (command === "recall") {
    const result = await workstreamMemoryService.recall(
      {
        query: positional(0),
        kinds: parseKinds(),
        facets: parseFacets(),
        includeContent: flag("content"),
        includeArchived: flag("include-archived"),
        limit: parsePositiveInt(option("limit"), "--limit"),
      },
      repoOptions(),
    );
    if (jsonOutput) {
      out(result);
      return;
    }
    console.log(`Memory repo: ${result.repo.root}`);
    if (!result.matches.length) console.log("No matching memory files found.");
    for (const match of result.matches) {
      console.log(`${match.entry.id} [${match.entry.kind}] score=${match.score} ${match.entry.path}`);
      console.log(`  ${match.entry.title}`);
      for (const summary of match.entry.summary) console.log(`  ${summary}`);
      if (match.content) console.log(`\n${match.content.trim()}\n`);
    }
    printIssues(result.issues);
    return;
  }

  if (command === "lint" || command === "doctor") {
    const catalog = await workstreamMemoryService.lint(repoOptions());
    const errors = catalog.issues.filter((issue) => issue.severity === "error").length;
    if (jsonOutput) {
      out({ ok: !catalog.issues.some((issue) => issue.severity === "error"), ...catalog });
      if (errors) process.exit(1);
      return;
    }
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

  if (command === "migrate" && positional(0) === "preview") {
    const repo = workstreamMemoryService.resolveRepo(repoOptions());
    const oldRoot = process.env.COMPANION_WORKSTREAM_MEMORY_DIR || "~/.companion/workstream-memory";
    const result = {
      targetRepo: repo.root,
      oldRoot,
      note: "The old schema-heavy workstream memory model is deprecated. Migration should convert only still-useful facts into authored Markdown files under the six memory directories.",
    };
    if (jsonOutput) out(result);
    else console.log(`${result.note}\nOld root: ${oldRoot}\nTarget repo: ${repo.root}`);
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
