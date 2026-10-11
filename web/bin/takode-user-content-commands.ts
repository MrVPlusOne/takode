/**
 * `takode user-content status|import|take-over|remove-skills`: the commands an
 * agent uses to set up and maintain the user's instructions and skills that
 * Takode keeps on the coordinator and delivers to every machine. The procedure
 * lives in the `takode-user-content` skill; these only act, always on the
 * user's approval for anything that replaces or moves the user's own files.
 */

import { takodeOptionalAuthHeaders } from "./takode-core.js";

type HostRow = { id: string; name: string; online?: boolean };

interface MachineStatus {
  hostId: string | null;
  error?: string;
  lastBackup?: { dir: string };
  result?: {
    instructionFiles: { path: string; state: string; detail?: string; onlyHere?: string[] }[];
    skills: { conflicts: { path: string; detail: string; onlyHere: string[] }[]; shadowedByTakode: string[] };
    notes: string[];
  };
}

interface Status {
  store: { instructions: string; skills: string };
  storeExists: boolean;
  storeEmpty: boolean;
  machines: MachineStatus[];
  importCandidates: {
    hostId: string | null;
    pending?: boolean;
    error?: string;
    summary?: { claudeChars: number; codexChars: number; sharedInstructions: boolean; skills: string[] };
  }[];
}

export const USER_CONTENT_USAGE =
  "Usage: takode user-content status [--json] | import --machine <name> | take-over --machine <name> | " +
  "remove-skills --machine <name> [<skill>...] [--dangling]";

export async function handleUserContent(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const json = rest.includes("--json");
  switch (subcommand) {
    case "status":
    case undefined:
      return showStatus(base, json);
    case "import":
      return act(base, "/user-content/import", { hostId: await machineOption(base, rest) });
    case "take-over":
      return act(base, "/user-content/take-over", { hostId: await machineOption(base, rest) });
    case "remove-skills": {
      const hostId = await machineOption(base, rest);
      const skills = positional(rest);
      const dangling = rest.includes("--dangling");
      if (!skills.length && !dangling) throw new Error(USER_CONTENT_USAGE);
      return act(base, "/user-content/remove-skills", { hostId, skills, dangling });
    }
    default:
      throw new Error(USER_CONTENT_USAGE);
  }
}

/** Words that are not flags or flag values. */
function positional(args: string[]): string[] {
  return args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--machine");
}

/** The host id for `--machine <name>`; this server's machine (by its name, `this` or `local`) is null. */
async function machineOption(base: string, args: string[]): Promise<string | null> {
  const index = args.indexOf("--machine");
  const name = index === -1 ? undefined : args[index + 1];
  if (!name) throw new Error(USER_CONTENT_USAGE);
  const { hosts, local } = (await request(base, "GET", "/hosts")) as { hosts: HostRow[]; local?: { name: string } };
  if (name === "this" || name === "local" || name === local?.name) return null;
  const host = hosts.find((candidate) => candidate.name === name || candidate.id === name);
  if (!host) throw new Error(`No machine named ${name}; see takode host list`);
  return host.id;
}

/** Changes are reported as JSON: they list exact paths and backup folders an agent passes on to the user. */
async function act(base: string, path: string, body: unknown): Promise<void> {
  console.log(JSON.stringify(await request(base, "POST", path, body), null, 2));
}

async function showStatus(base: string, json: boolean): Promise<void> {
  const status = (await request(base, "GET", "/user-content")) as Status;
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  const { hosts, local } = (await request(base, "GET", "/hosts")) as { hosts: HostRow[]; local?: { name: string } };
  const name = (hostId: string | null) =>
    hostId === null
      ? `${local?.name ?? "this machine"} (this machine)`
      : (hosts.find((h) => h.id === hostId)?.name ?? hostId);
  console.log(`Store: ${status.store.instructions} and ${status.store.skills}`);
  if (!status.storeExists) console.log("No store yet: Takode touches no machine's files.");
  else if (status.storeEmpty) console.log("The store is empty.");
  if (status.storeEmpty) {
    console.log("\nWhat an import from each connected machine would bring in:");
    for (const candidate of status.importCandidates) {
      const s = candidate.summary;
      const text = s
        ? `rules ${s.claudeChars} chars for Claude, ${s.codexChars} for Codex${s.sharedInstructions ? " (one shared text)" : ""}; skills: ${s.skills.join(", ") || "none"}`
        : candidate.pending
          ? "still reading; run again shortly"
          : `could not read: ${candidate.error}`;
      console.log(`  ${name(candidate.hostId)}: ${text}`);
    }
    return;
  }
  for (const machine of status.machines) {
    console.log(`\n${name(machine.hostId)}`);
    if (machine.error) console.log(`  could not deliver: ${machine.error}`);
    const waiting = [
      ...(machine.result?.instructionFiles.filter((file) => file.state === "conflict") ?? []),
      ...(machine.result?.skills.conflicts ?? []),
    ];
    if (!machine.error && !waiting.length) console.log("  up to date");
    for (const item of waiting) {
      console.log(`  waiting: ${item.path} (${item.detail})`);
      const onlyHere = item.onlyHere ?? [];
      console.log(
        onlyHere.length
          ? onlyHere.map((line) => `    only here: ${line}`).join("\n")
          : "    nothing that the store lacks",
      );
    }
    for (const path of machine.result?.skills.shadowedByTakode ?? [])
      console.log(`  Takode's own skill used instead of: ${path}`);
    for (const note of machine.result?.notes ?? []) console.log(`  note: ${note}`);
    if (machine.lastBackup) console.log(`  last backup: ${machine.lastBackup.dir}`);
  }
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
