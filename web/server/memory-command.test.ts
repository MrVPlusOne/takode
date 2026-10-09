import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMemoryServerCommand, memoryCommandInputFile, runMemoryCommand } from "./memory-command.js";

describe("memory command routing", () => {
  // The `memory` CLI sends exactly these commands to the server, the only writer of memory data.
  // Catalog reads count as writes because they record freshness snapshots and handles.
  it("classifies commands that write memory data or bookkeeping as server commands", () => {
    for (const args of [
      ["catalog"],
      ["catalog", "show", "voice", "--seen", "mem-0123456789"],
      ["--root", "/tmp/m", "catalog", "diff"],
      ["helpful", "voice/a.md"],
      ["mv", "a.md", "b.md"],
      ["write", "voice/a.md", "--file", "-"],
      ["rm", "voice/a.md"],
      ["commit", "--message", "x"],
      ["lock", "acquire", "--owner", "w"],
      ["lock", "release"],
    ]) {
      expect({ args, server: isMemoryServerCommand(args) }).toEqual({ args, server: true });
    }
    for (const args of [
      [],
      ["help"],
      ["catalog", "--help"],
      ["repo", "path"],
      ["read", "voice/a.md"],
      ["grep", "pattern", "--ignore-case"],
      ["lint"],
      ["doctor"],
      ["status"],
      ["diff"],
      ["lock"],
      ["lock", "status"],
      ["recall", "anything"],
    ]) {
      expect({ args, server: isMemoryServerCommand(args) }).toEqual({ args, server: false });
    }
  });

  it("names the file a server-run move or write needs from the caller", () => {
    expect(memoryCommandInputFile(["mv", "--plan", "/tmp/plan.txt"])).toBe("/tmp/plan.txt");
    expect(memoryCommandInputFile(["write", "voice/a.md", "--file", "-"])).toBe("-");
    expect(memoryCommandInputFile(["mv", "a.md", "b.md"])).toBeUndefined();
    expect(memoryCommandInputFile(["catalog", "--plan", "/tmp/plan.txt"])).toBeUndefined();
  });
});

describe("runMemoryCommand", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "memory-command-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // The command runs inside the server process, so it must report through its result
  // instead of writing to or exiting the process.
  it("captures output, errors and exit codes instead of touching the process", async () => {
    const context = { defaults: { root }, readTextFile: async () => "" };

    const help = await runMemoryCommand(["help"], context);
    expect(help).toMatchObject({ exitCode: 0, stderr: "" });
    expect(help.stdout).toContain("Usage: memory [options] <command> [args]");

    const unknown = await runMemoryCommand(["upsert"], context);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toBe("Error: Unknown memory command: upsert\n");
    expect(unknown.stdout).toContain("Usage: memory");

    const badTtl = await runMemoryCommand(["lock", "acquire", "--ttl-ms", "-5"], context);
    expect(badTtl).toEqual({ exitCode: 1, stdout: "", stderr: "Error: --ttl-ms must be a positive integer\n" });
  });

  it("reads a move plan through the context instead of the local filesystem", async () => {
    await mkdir(join(root, "voice"), { recursive: true });
    await writeFile(
      join(root, "voice", "a.md"),
      '---\ndescription: "Read when a."\ntype: decision\nsource: [q-1]\n---\n\nA.\n',
    );
    const plans: string[] = [];
    const context = {
      defaults: { root },
      readTextFile: async (path: string) => {
        plans.push(path);
        return "voice/a.md audio/a.md\n";
      },
    };
    expect((await runMemoryCommand(["lock", "acquire"], context)).exitCode).toBe(0);

    const moved = await runMemoryCommand(["mv", "--plan", "sent-by-client.txt"], context);

    expect(plans).toEqual(["sent-by-client.txt"]);
    expect(moved).toMatchObject({ exitCode: 0, stderr: "" });
    expect(moved.stdout).toContain("Moved 1 note(s)");
  });

  // Agents on machines without the repo read, search and edit notes only through
  // these commands, so they must cover the whole note lifecycle and keep every
  // path inside the repo.
  it("reads, searches, writes and removes notes by repo-relative path", async () => {
    const drafts: Record<string, string> = {
      draft: '---\ndescription: "Read when b."\ntype: decision\nsource: [q-1]\n---\n\nBeta Line.\n',
    };
    const context = { defaults: { root }, readTextFile: async (path: string) => drafts[path] ?? "" };
    const run = (args: string[]) => runMemoryCommand(args, context);

    // Writes need the lock, like every other repo change.
    expect((await run(["write", "voice/b.md", "--file", "draft"])).stderr).toContain("Acquire the memory repo lock");
    expect((await run(["lock", "acquire"])).exitCode).toBe(0);
    expect(await run(["write", "voice/b.md", "--file", "draft"])).toMatchObject({
      exitCode: 0,
      stdout: "Wrote voice/b.md.\n",
    });

    expect((await run(["read", "voice/b.md"])).stdout).toBe(drafts.draft);
    expect((await run(["grep", "beta", "--ignore-case"])).stdout).toBe("voice/b.md:7:Beta Line.\n");
    expect((await run(["grep", "beta"])).stdout).toBe("No matches.\n");
    expect((await run(["grep", "Beta", "other"])).stdout).toBe("No matches.\n");

    for (const args of [
      ["read", "../outside.md"],
      ["write", ".git/hooks.md", "--file", "draft"],
      ["write", "voice/b.txt", "--file", "draft"],
    ]) {
      expect({ args, exitCode: (await run(args)).exitCode }).toEqual({ args, exitCode: 1 });
    }

    expect((await run(["rm", "voice/b.md"])).stdout).toBe("Removed voice/b.md.\n");
    expect((await run(["read", "voice/b.md"])).stderr).toBe("Error: Not a memory note: voice/b.md\n");
  });

  // The lock belongs to the requesting session: others cannot write under it while its holder
  // lives, and the next writer takes it over as soon as the holder session has ended.
  it("enforces the lock holder and recovers a dead holder's lock", async () => {
    const draft = '---\ndescription: "Read when c."\ntype: decision\nsource: [q-1]\n---\n\nC.\n';
    const ended = new Set<string>();
    const as = (session: string) => (args: string[]) =>
      runMemoryCommand(args, {
        defaults: { root },
        session,
        isSessionGone: (holder) => ended.has(holder),
        readTextFile: async () => draft,
      });
    const holder = as("session-a");
    const other = as("session-b");

    expect((await holder(["lock", "acquire", "--owner", "a"])).exitCode).toBe(0);
    // Live holder: another session can neither write, commit nor take the lock.
    const refused = await other(["write", "voice/c.md", "--file", "draft"]);
    expect(refused).toMatchObject({ exitCode: 1 });
    expect(refused.stderr).toContain("held by session session-a (owner a), not by session session-b");
    expect(
      (await other(["commit", "--message", "x", "--source", "q-1", "--memory-id", "voice/c.md"])).stderr,
    ).toContain("not by session session-b");
    expect((await other(["lock", "acquire"])).stderr).toContain("already locked by a (session-a)");
    expect((await holder(["write", "voice/c.md", "--file", "draft"])).exitCode).toBe(0);

    // Dead holder: its lock is taken over without waiting for expiry, and the old holder is refused.
    ended.add("session-a");
    expect((await other(["lock", "acquire", "--owner", "b"])).exitCode).toBe(0);
    expect((await holder(["rm", "voice/c.md"])).stderr).toContain("held by session session-b");
    expect((await other(["commit", "--message", "x", "--source", "q-1", "--memory-id", "voice/c.md"])).stdout).toMatch(
      /^committed [0-9a-f]+/,
    );
  });
});
