import { workstreamMemoryService } from "./workstream-memory-service.js";
import {
  applyMemoryHandle,
  defaultMachineLine,
  defaultNoteMachine,
  machineTag,
  noteViewLine,
  type MemoryViewLine,
} from "./memory-catalog-view.js";
import { memoryHealthSummary } from "./memory-repo-health.js";
import { machineContextForSession, sessionMachineName } from "./remote-host/machines.js";
import { parseMovePlan } from "./memory-move.js";
import { grepMemoryNotes, readMemoryNotes, removeMemoryNote, writeMemoryNote } from "./memory-note-files.js";
import {
  MEMORY_COMMIT_OPERATIONS,
  MEMORY_DESCRIPTION_CHAR_LIMIT,
  MEMORY_NOTE_TYPES,
  type MemoryCommitOperation,
  type MemoryRepoOptions,
} from "./workstream-memory-types.js";

/** Exact observable result of one `memory` command. */
export interface MemoryCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** What a `memory` command would otherwise read from its caller's process. */
export interface MemoryCommandContext {
  /** Repo selection defaults; command-line options such as `--root` override them. */
  defaults?: MemoryRepoOptions;
  /** Session recorded on a new lock; the catalog overview names the machine it runs on. */
  session?: string;
  /** Key for the per-session catalog snapshot behind `catalog diff`. */
  catalogSessionKey?: string;
  /** Inspect repos without creating, migrating or indexing them. */
  readOnly?: boolean;
  /** Read a file named on the command line (`mv --plan`, `write --file`); `-` is the caller's stdin. */
  readTextFile: (path: string) => Promise<string>;
}

const VALUE_OPTIONS = new Set(["--root", "--server-id", "--server-slug", "--session-space"]);
/** Flags that never take a value, so the next token stays positional. */
const BOOLEAN_FLAGS = new Set(["--json", "--all", "--no-steal-stale", "--help", "--ignore-case"]);

/**
 * Commands that change the memory repo or its bookkeeping (locks, helpful marks,
 * catalog handles and freshness snapshots). The server runs these; every other
 * command only reads and may run in the caller's process.
 */
export function isMemoryServerCommand(args: readonly string[]): boolean {
  const parsed = parseMemoryArgs(args);
  if (parsed.flag("help")) return false;
  switch (parsed.command) {
    case "catalog":
    case "helpful":
    case "mv":
    case "write":
    case "rm":
    case "commit":
      return true;
    case "lock": {
      const subcommand = parsed.positional(0) ?? "status";
      return subcommand === "acquire" || subcommand === "release";
    }
    default:
      return false;
  }
}

/** The command name and the arguments after it, skipping global options before the command. */
export function splitMemoryCommand(args: readonly string[]): { command: string | undefined; rest: string[] } {
  const index = findCommandIndex([...args]);
  return index === -1 ? { command: undefined, rest: [] } : { command: args[index], rest: args.slice(index + 1) };
}

/** The file a command reads from the caller's machine (`mv --plan`, `write --file`), if any. */
export function memoryCommandInputFile(args: readonly string[]): string | undefined {
  const parsed = parseMemoryArgs(args);
  if (parsed.command === "mv") return parsed.option("plan");
  if (parsed.command === "write") return parsed.option("file");
  return undefined;
}

/** Run one `memory` command and capture its output instead of writing to the process. */
export async function runMemoryCommand(
  args: readonly string[],
  context: MemoryCommandContext,
): Promise<MemoryCommandResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CommandIo = { print: (text) => stdout.push(text), printError: (text) => stderr.push(text) };
  let exitCode = 0;
  try {
    exitCode = await executeMemoryCommand(parseMemoryArgs(args), context, io);
  } catch (error) {
    stderr.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  }
  return { exitCode, stdout: joinLines(stdout), stderr: joinLines(stderr) };
}

interface CommandIo {
  print: (text: string) => void;
  printError: (text: string) => void;
}

interface ParsedMemoryArgs {
  command: string | undefined;
  flag: (name: string) => boolean;
  option: (name: string) => string | undefined;
  options: (name: string) => string[];
  positional: (index: number) => string | undefined;
  positionals: () => string[];
}

function parseMemoryArgs(input: readonly string[]): ParsedMemoryArgs {
  const args = [...input];
  const commandIndex = findCommandIndex(args);
  const flag = (name: string) => args.includes(`--${name}`);
  const option = (name: string) => {
    const index = args.indexOf(`--${name}`);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
    return undefined;
  };
  const options = (name: string) => {
    const values: string[] = [];
    for (let index = 0; index < args.length; index++) {
      if (args[index] === `--${name}` && args[index + 1] && !args[index + 1].startsWith("--")) {
        values.push(args[index + 1]);
        index += 1;
      }
    }
    return values;
  };
  const positional = (index: number) => {
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
  };
  const positionals = () => {
    const values: string[] = [];
    for (let index = 0; ; index++) {
      const value = positional(index);
      if (value === undefined) return values;
      values.push(value);
    }
  };
  return {
    command: commandIndex === -1 ? undefined : args[commandIndex],
    flag,
    option,
    options,
    positional,
    positionals,
  };
}

function findCommandIndex(tokens: string[]): number {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith("--")) return index;
    if (VALUE_OPTIONS.has(token) && tokens[index + 1] && !tokens[index + 1].startsWith("--")) index += 1;
  }
  return -1;
}

function joinLines(lines: string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Usage text printed by `memory --help` and after unknown commands. */
export function memoryCommandUsage(): string {
  return `Usage: memory [options] <command> [args]

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
  read <path>...
      Print notes in full (repo-relative paths, as the catalog shows them).
  grep <pattern> [<folder-or-note>...] [--ignore-case] [--limit N]
      Matching lines as path:line:text. The pattern is a JavaScript regular expression.
  helpful <path>...
      Record that notes helped. A mark counts as touching the note for the recent list.
  repo path
      Print the resolved repo root (on the Takode server's machine).

Writing (hold the lock):
  lock status|acquire|release [--owner NAME] [--ttl-ms N]
  write <path> --file <draft>|-
      Create or replace a note or folder README with the draft's full text (- reads stdin).
  rm <path>
      Delete a note.
  mv <old-path> <new-path> | mv --plan <file>
      Move notes and rewrite every reference to them. A plan has one "old new" pair per line.
  lint
      Health check: summary line, then errors and warnings. Commits are blocked only by errors.
  status | diff
      Pending Git changes.
  commit --message TEXT [--quest q-N] [--session N] [--operation update|repair|...] [--memory-id PATH] [--source REF]
      Commit with provenance trailers. Stamps \`updated:\` on changed notes unless --operation repair
      (use repair for moves, README edits and description fixes).

Commands run on the Takode server that owns the repo, so they work the same from any machine;
run them from a Takode session or set COMPANION_PORT to the server's port. Without a server,
reading commands run against the local repo and writing commands fail.

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
  machines: [name, ...] (machines the note was written on; stamped by memory write and commit)
  source: [q-N]   (quest ID for quest-backed notes; session:<id> only without a quest)
Notes live in topic folders (5-25 notes each), each with a README.md holding a one-line description.

Write flow:
  memory lock acquire --owner <session-or-role>
  memory write <path> --file <draft>   (move notes only with memory mv)
  memory lint
  memory diff
  memory commit --message "Update memory" --source <source-ref> --memory-id <repo-relative-path>
  memory lock release`;
}

async function executeMemoryCommand(
  parsed: ParsedMemoryArgs,
  context: MemoryCommandContext,
  io: CommandIo,
): Promise<number> {
  const { command, flag, option, options, positional, positionals } = parsed;
  const jsonOutput = flag("json");
  const out = (data: unknown) => io.print(JSON.stringify(data, null, 2));
  const repoOptions = (): MemoryRepoOptions => {
    const overrides = {
      root: option("root"),
      serverId: option("server-id"),
      serverSlug: option("server-slug"),
      sessionSpaceSlug: option("session-space"),
    };
    const defined = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
    return {
      ...context.defaults,
      ...defined,
      ...(context.catalogSessionKey ? { catalogSessionKey: context.catalogSessionKey } : {}),
      ...(context.readOnly ? { readOnly: true } : {}),
    };
  };

  if (!command || flag("help") || command === "help") {
    io.print(memoryCommandUsage());
    return 0;
  }

  if (command === "repo") {
    const subcommand = positional(0) ?? "path";
    if (subcommand !== "path") throw new Error("repo subcommand must be path");
    const repo = workstreamMemoryService.resolveRepo(repoOptions());
    if (jsonOutput) out(repo);
    else io.print(repo.root);
    return 0;
  }

  if (command === "catalog") {
    const subcommand = positional(0);
    if (subcommand === "diff") {
      await printCatalogDiff(
        await workstreamMemoryService.catalogDiff(repoOptions()),
        repoOptions(),
        { json: jsonOutput, seen: option("seen") },
        io,
      );
      return 0;
    }
    if (subcommand && subcommand !== "show") throw new Error("catalog subcommand must be show or diff");
    const folder = positional(1);
    if (jsonOutput) {
      const catalog = await workstreamMemoryService.catalog(repoOptions());
      out({ repo: catalog.repo, entries: catalog.entries, folders: catalog.folders, issues: catalog.issues });
      if (!folder) await workstreamMemoryService.markCatalogSeen(catalog, repoOptions());
      return 0;
    }
    const request = folder
      ? ({ mode: "folder", folder } as const)
      : flag("all")
        ? ({ mode: "all" } as const)
        : ({ mode: "overview" } as const);
    const { catalog, view } = await workstreamMemoryService.catalogView(
      request,
      repoOptions(),
      option("seen"),
      machineContextForSession(context.session) ?? undefined,
    );
    io.print(view.text);
    if (!folder) await workstreamMemoryService.markCatalogSeen(catalog, repoOptions());
    return 0;
  }

  if (command === "read") {
    const paths = positionals();
    if (!paths.length) throw new Error("read needs at least one repo-relative note path");
    const notes = await readMemoryNotes(paths, repoOptions());
    if (jsonOutput) out(notes);
    else
      io.print(
        notes.map((note) => (notes.length > 1 ? `==> ${note.path} <==\n` : "") + note.content.trimEnd()).join("\n\n"),
      );
    return 0;
  }

  if (command === "grep") {
    const [pattern, ...paths] = positionals();
    if (!pattern) throw new Error("grep needs a pattern");
    const result = await grepMemoryNotes(
      pattern,
      { paths, ignoreCase: flag("ignore-case"), limit: parsePositiveInt(option("limit"), "--limit") ?? 200 },
      repoOptions(),
    );
    if (jsonOutput) out(result);
    else if (!result.lines.length) io.print("No matches.");
    else {
      io.print(result.lines.join("\n"));
      if (result.omitted)
        io.print(`(${result.omitted} more matching lines; narrow the pattern, pass a folder, or raise --limit)`);
    }
    return 0;
  }

  if (command === "write") {
    const path = positional(0);
    if (!path) throw new Error("write needs a repo-relative note path");
    const written = await writeMemoryNote(
      path,
      await context.readTextFile(requireOption(option, "file")),
      repoOptions(),
      sessionMachineName(context.session),
    );
    if (jsonOutput) out({ written });
    else io.print(`Wrote ${written}.`);
    return 0;
  }

  if (command === "rm") {
    const path = positional(0);
    if (!path) throw new Error("rm needs a repo-relative note path");
    const removed = await removeMemoryNote(path, repoOptions());
    if (jsonOutput) out({ removed });
    else io.print(`Removed ${removed}.`);
    return 0;
  }

  if (command === "helpful") {
    const paths = positionals();
    if (!paths.length) throw new Error("helpful needs at least one repo-relative note path");
    const result = await workstreamMemoryService.markHelpful(paths, repoOptions());
    if (jsonOutput) out(result);
    else io.print(`Marked ${result.marked.length} note(s) helpful on ${result.date}.`);
    return 0;
  }

  if (command === "mv") {
    const planPath = option("plan");
    const moves = planPath
      ? parseMovePlan(await context.readTextFile(planPath))
      : (() => {
          const [from, to] = positionals();
          if (!from || !to) throw new Error("mv needs <old-path> <new-path>, or --plan <file>");
          return [{ from, to }];
        })();
    const result = await workstreamMemoryService.move(moves, repoOptions());
    if (jsonOutput) out(result);
    else
      io.print(
        `Moved ${result.moved} note(s); rewrote references in ${result.rewrittenNotes} other note(s). Commit with --operation repair.`,
      );
    return 0;
  }

  if (command === "lint" || command === "doctor") {
    const catalog = await workstreamMemoryService.lint(repoOptions());
    const errors = catalog.issues.filter((issue) => issue.severity === "error").length;
    if (jsonOutput) {
      out({ ok: !errors, repo: catalog.repo, entries: catalog.entries, issues: catalog.issues });
      return errors ? 1 : 0;
    }
    io.print(await memoryHealthSummary(catalog));
    printIssues(catalog.issues, io);
    const warnings = catalog.issues.filter((issue) => issue.severity === "warning").length;
    io.print(
      errors || warnings ? `Memory lint found ${errors} errors and ${warnings} warnings.` : "Memory lint passed.",
    );
    return errors ? 1 : 0;
  }

  if (command === "lock") {
    const subcommand = positional(0) ?? "status";
    if (subcommand === "status") {
      const status = await workstreamMemoryService.lockStatus(repoOptions());
      if (jsonOutput) out(status);
      else io.print(status.locked ? `locked: ${status.owner ?? "unknown"} ${status.expiresAt ?? ""}` : "unlocked");
      return 0;
    }
    if (subcommand === "acquire") {
      const status = await workstreamMemoryService.acquireLock({
        ...repoOptions(),
        owner: option("owner"),
        ...(context.session ? { session: context.session } : {}),
        ttlMs: parsePositiveInt(option("ttl-ms"), "--ttl-ms"),
        stealStale: !flag("no-steal-stale"),
      });
      if (jsonOutput) out(status);
      else io.print(`locked: ${status.lockPath}`);
      return 0;
    }
    if (subcommand === "release") {
      const status = await workstreamMemoryService.releaseLock(repoOptions());
      if (jsonOutput) out(status);
      else io.print("unlocked");
      return 0;
    }
    throw new Error("lock subcommand must be status, acquire, or release");
  }

  if (command === "status") {
    const status = await workstreamMemoryService.gitStatus(repoOptions());
    if (jsonOutput) out({ status });
    else io.print(status || "clean");
    return 0;
  }

  if (command === "diff") {
    io.print(await workstreamMemoryService.gitDiff(repoOptions()));
    return 0;
  }

  if (command === "commit") {
    const lock = await workstreamMemoryService.lockStatus(repoOptions());
    if (!lock.locked || lock.stale) throw new Error("Acquire the memory repo lock before committing memory changes.");
    const result = await workstreamMemoryService.commit({
      ...repoOptions(),
      message: requireOption(option, "message"),
      quest: option("quest"),
      session: option("session"),
      operation: parseOperation(option("operation")),
      memoryIds: [...options("memory-id"), ...parseCsv(option("memory-ids"))],
      sources: [...options("source"), ...parseCsv(option("sources"))],
      machine: sessionMachineName(context.session),
    });
    if (jsonOutput) out(result);
    else io.print(result.committed ? `committed ${result.sha}` : result.message);
    return 0;
  }

  io.printError(`Error: Unknown memory command: ${command}`);
  io.print(memoryCommandUsage());
  return 1;
}

async function printCatalogDiff(
  diff: Awaited<ReturnType<typeof workstreamMemoryService.catalogDiff>>,
  repoOptions: MemoryRepoOptions,
  view: { json: boolean; seen: string | undefined },
  io: CommandIo,
): Promise<void> {
  if (view.json) {
    io.print(JSON.stringify(diff, null, 2));
    return;
  }
  // Versions must match catalog outputs so a later listing can skip what diff already showed.
  const catalog = await workstreamMemoryService.catalog(repoOptions);
  const hashes = catalog.contentHashes ?? {};
  const defaultMachine = defaultNoteMachine(catalog.entries);
  const lines: MemoryViewLine[] = [{ text: `Memory repo: ${diff.repo.root}` }];
  lines.push({
    text: diff.previousSeenAt
      ? `Catalog changes since ${diff.previousSeenAt}:`
      : "No prior catalog snapshot for this session; current entries are shown as new:",
  });
  if (!diff.changes.length) lines.push({ text: "No catalog changes since last seen." });
  else lines.push(...defaultMachineLine(defaultMachine));
  for (const change of diff.changes) {
    const entry = change.after ?? change.before;
    const description = entry?.description ? ` ${entry.description}` : "";
    const tag = change.after ? machineTag(change.after, defaultMachine) : "";
    const text = `${change.kind}: ${change.path}${tag}${description}`;
    // A changed note's new version is now shown; record it so later reads can skip it.
    lines.push(change.after ? { ...noteViewLine(change.after, hashes[change.path], defaultMachine), text } : { text });
  }
  const rendered = await applyMemoryHandle(diff.repo.root, lines, { seen: view.seen });
  io.print(rendered.text);
}

function printIssues(issues: { severity: string; path?: string; message: string }[], io: CommandIo): void {
  if (!issues.length) return;
  io.print("\nIssues:");
  for (const issue of issues) {
    const path = issue.path ? `${issue.path}: ` : "";
    io.print(`  ${issue.severity}: ${path}${issue.message}`);
  }
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
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseOperation(raw: string | undefined): MemoryCommitOperation | undefined {
  if (!raw) return undefined;
  if (MEMORY_COMMIT_OPERATIONS.includes(raw as MemoryCommitOperation)) return raw as MemoryCommitOperation;
  throw new Error(`--operation must be one of: ${MEMORY_COMMIT_OPERATIONS.join(", ")}`);
}

function requireOption(option: (name: string) => string | undefined, name: string): string {
  const value = option(name);
  if (!value?.trim()) throw new Error(`--${name} is required`);
  return value.trim();
}
