import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { MemoryRepoOptions } from "./workstream-memory-types.js";
import { MEMORY_MACHINE_STAMPS_MARKER } from "./constants.js";

/**
 * Memory notes record the machines they were written on in a `machines:`
 * frontmatter list, in the order the machines first wrote them. With sessions on
 * several machines sharing one repo, a reader can then tell which machine a
 * note's paths, commands and environment facts describe. The server stamps the
 * writing session's machine on `memory write` and on every non-repair commit.
 */

const FIELD = "machines";
const execFileAsync = promisify(execFile);

/** The note's `machines:` list, or undefined when the note has no such field (or no frontmatter). */
export function noteMachines(content: string): string[] | undefined {
  const block = frontmatterBlock(content);
  if (!block) return undefined;
  const index = fieldLine(block.lines, block.end);
  if (index < 0) return undefined;
  const inline = block.lines[index].slice(FIELD.length + 1).trim();
  const values = inline
    ? inline.replace(/^\[|\]$/g, "").split(",")
    : blockListLines(block.lines, index, block.end).map((line) => line.replace(/^\s+-\s+/, ""));
  return values.map((value) => value.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/**
 * Add `machine` to a note's list. The base list is the content's own, else the one
 * in `previousContent` (the note before this write, so a draft that leaves the
 * field out keeps it). Content without frontmatter is returned unchanged.
 */
export function stampNoteMachine(content: string, machine: string, previousContent?: string): string {
  if (!frontmatterBlock(content)) return content;
  const machines = noteMachines(content) ?? (previousContent ? noteMachines(previousContent) : undefined) ?? [];
  if (!machines.includes(machine)) machines.push(machine);
  return setNoteMachines(content, machines);
}

/** Write the list as one `machines: [a, b]` line, replacing any existing field in place. */
function setNoteMachines(content: string, machines: string[]): string {
  const block = frontmatterBlock(content);
  if (!block) return content;
  const lines = [...block.lines];
  const line = `${FIELD}: [${machines.join(", ")}]`;
  const existing = fieldLine(lines, block.end);
  if (existing >= 0) {
    lines.splice(existing, 1 + blockListLines(lines, existing, block.end).length, line);
    return lines.join("\n");
  }
  // After `updated:` (else `type:`, else `description:`) so it sits with the other note facts.
  const anchor = ["updated", "type", "description"]
    .map((key) => lines.findIndex((text, index) => index > 0 && index < block.end && text.startsWith(`${key}:`)))
    .find((index) => index >= 0);
  lines.splice(anchor === undefined ? 1 : anchor + 1, 0, line);
  return lines.join("\n");
}

function frontmatterBlock(content: string): { lines: string[]; end: number } | null {
  const lines = content.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, "") === "---");
  return end < 0 ? null : { lines, end };
}

function fieldLine(lines: string[], end: number): number {
  return lines.findIndex((line, index) => index > 0 && index < end && line.startsWith(`${FIELD}:`));
}

function blockListLines(lines: string[], fieldIndex: number, end: number): string[] {
  const items: string[] = [];
  for (let index = fieldIndex + 1; index < end && /^\s+-\s+/.test(lines[index]); index++) items.push(lines[index]);
  return items;
}

export interface ExistingNoteStampResult {
  root: string;
  /** "stamped" committed stamps; "done" had nothing to stamp or ran before; "skipped" retries at the next start. */
  outcome: "stamped" | "done" | "skipped";
  notes: number;
  commit?: string;
  reason?: string;
}

/** Stamp existing notes in every memory repo this server owns (see `stampExistingMemoryNotes`). */
export async function stampExistingMemoryNotesInOwnSpaces(machine: string): Promise<ExistingNoteStampResult[]> {
  const { workstreamMemoryService: memory } = await import("./workstream-memory-service.js");
  const serverId = memory.resolveRepo().serverId;
  const results: ExistingNoteStampResult[] = [];
  for (const space of await memory.spaces()) {
    // Repos of other servers are read-only here, like everywhere else.
    if (!space.initialized || !space.hasAuthoredData || space.serverId !== serverId) continue;
    results.push(
      await stampExistingMemoryNotes(machine, {
        root: space.root,
        serverId,
        serverSlug: space.slug,
        ...(space.sessionSpaceSlug ? { sessionSpaceSlug: space.sessionSpaceSlug } : {}),
      }),
    );
  }
  return results;
}

/**
 * Once per repo: stamp every note that has no `machines:` with `machine`, the
 * coordinator's, where every note written before stamps existed was written.
 * Runs under the memory lock, only on a clean repo, and commits the stamps as a
 * repair (no `updated:` change) so `git revert` undoes it. A marker in `.git`
 * records the run; a busy or dirty repo is left alone and tried again next start.
 */
export async function stampExistingMemoryNotes(
  machine: string,
  options: MemoryRepoOptions,
): Promise<ExistingNoteStampResult> {
  const { workstreamMemoryService: memory } = await import("./workstream-memory-service.js");
  const root = memory.resolveRepo(options).root;
  const markerPath = join(root, ".git", MEMORY_MACHINE_STAMPS_MARKER);
  if (await exists(markerPath)) return { root, outcome: "done", notes: 0, reason: "already run" };
  try {
    await memory.acquireLock({ ...options, owner: "takode-machine-stamps", session: "server" });
  } catch (error) {
    return { root, outcome: "skipped", notes: 0, reason: error instanceof Error ? error.message : String(error) };
  }
  const originals = new Map<string, string>();
  try {
    // Never mix someone's pending edits into this commit.
    if (await memory.gitStatus(options)) return { root, outcome: "skipped", notes: 0, reason: "uncommitted changes" };
    for (const entry of (await memory.catalog(options)).entries) {
      const content = await readFile(join(root, entry.path), "utf-8");
      if (noteMachines(content)) continue;
      const next = stampNoteMachine(content, machine);
      if (next === content) continue;
      originals.set(entry.path, content);
      await writeFile(join(root, entry.path), next, "utf-8");
    }
    const notes = originals.size;
    let commit: string | undefined;
    if (notes) {
      await git(root, ["add", "--", ...originals.keys()]);
      const message = [
        `Record that existing notes were written on ${machine}`,
        "",
        "Memory-Operation: repair",
        "Source: takode:machine-stamps",
      ].join("\n");
      await git(root, [
        "-c",
        "user.name=Takode Memory",
        "-c",
        "user.email=takode-memory@local",
        "commit",
        "-q",
        "-m",
        message,
      ]);
      originals.clear(); // Committed: Git owns the way back now.
      commit = (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
    }
    const record = { stampedAt: new Date().toISOString(), machine, notes, commit: commit ?? null };
    await writeFile(markerPath, JSON.stringify(record, null, 2), "utf-8");
    return commit ? { root, outcome: "stamped", notes, commit } : { root, outcome: "done", notes: 0 };
  } catch (error) {
    // Leave the repo as it was so the next start can try again.
    for (const [path, content] of originals) await writeFile(join(root, path), content, "utf-8");
    if (originals.size) await git(root, ["reset", "-q", "--", ...originals.keys()]).catch(() => undefined);
    throw error;
  } finally {
    await memory.releaseLock(options);
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", "-C", root, ...args]);
  return String(stdout);
}
