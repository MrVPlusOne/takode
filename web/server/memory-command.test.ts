import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMemoryServerCommand, memoryCommandPlanPath, runMemoryCommand } from "./memory-command.js";

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

  it("names the plan file a server-run move needs from the caller", () => {
    expect(memoryCommandPlanPath(["mv", "--plan", "/tmp/plan.txt"])).toBe("/tmp/plan.txt");
    expect(memoryCommandPlanPath(["mv", "a.md", "b.md"])).toBeUndefined();
    expect(memoryCommandPlanPath(["catalog", "--plan", "/tmp/plan.txt"])).toBeUndefined();
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
});
