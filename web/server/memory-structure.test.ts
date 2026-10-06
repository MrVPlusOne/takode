import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveMemoryNotes, parseMovePlan, rewriteMemoryReferences } from "./memory-move.js";
import { checkMemoryRepoHealth, staleMemoryReferences } from "./memory-repo-health.js";
import { readHelpfulMarks, writeHelpfulMarks } from "./memory-repo-layout.js";
import { acquireMemoryLock, commitMemory, lintMemory, scanMemoryCatalog } from "./workstream-memory-store.js";

const execFileAsync = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), "memory-structure-")), "repo");
  await mkdir(root, { recursive: true });
  await execFileAsync("git", ["-C", root, "init", "-q"]);
});

afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

async function note(path: string, frontmatter: string, body = "Body."): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), `---\n${frontmatter.trim()}\nsource:\n  - q-1\n---\n\n${body}\n`);
}

async function commitAll(message: string): Promise<void> {
  await execFileAsync("git", ["-C", root, "add", "-A"]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message]);
}

describe("memory repo health", () => {
  it("flags legacy type folders, folder sizes, missing READMEs, routing lines and duplicate names", async () => {
    await note("decisions/a.md", 'description: "Read when a."');
    await note("voice/b.md", 'description: "Summarizes b."\ntype: decision');
    await note("codex/b.md", 'description: "Read when other b."\ntype: decision');

    const issues = await checkMemoryRepoHealth(await scanMemoryCatalog({ root }));
    const messages = issues.map((issue) => `${issue.path}: ${issue.message}`);
    expect(messages).toContainEqual(expect.stringMatching(/^decisions\/: Legacy type folder/));
    expect(messages).toContainEqual(expect.stringMatching(/^voice\/: Folder has 1 entry; keep 5-25/));
    expect(messages).toContainEqual(expect.stringMatching(/^voice\/: Folder has no README.md description/));
    expect(messages).toContainEqual(expect.stringMatching(/^voice\/b.md: Description should be a routing line/));
    // Legacy folders only get the curation warning, not size/README noise.
    expect(messages.filter((message) => message.startsWith("decisions/:"))).toHaveLength(1);
    const duplicates = issues.filter((issue) => issue.message.startsWith("File name is not unique"));
    expect(duplicates.map((issue) => issue.path).sort()).toEqual(["codex/b.md", "voice/b.md"]);
    expect(duplicates.every((issue) => issue.blocksCommitOfNote)).toBe(true);
  });

  it("finds references to moved notes but ignores paths that are not memory notes", () => {
    const notePaths = new Set(["codex/policy.md", "voice/build.md"]);
    const folders = new Set(["codex", "voice"]);
    const content = [
      "See [policy](../decisions/policy.md) and [build](../voice/build.md).",
      "Also `decisions/policy.md` and `references/port-tracking.md` from a skill.",
      `Absolute: file:${root}/decisions/policy.md:12`,
    ].join("\n");
    // decisions/policy.md moved to codex/; references/port-tracking.md is a skill file, not a note.
    expect(staleMemoryReferences(content, "voice", root, notePaths, folders)).toEqual(["decisions/policy.md"]);
  });

  it("turns per-note rules into errors only for the notes a commit would change", async () => {
    const long = `"Read when ${"x".repeat(260)}"`;
    await note("decisions/old.md", `description: ${long}`);
    await commitAll("old note");
    expect((await lintMemory({ root })).issues.filter((issue) => issue.severity === "error")).toEqual([]);

    await note("decisions/old.md", `description: ${long}`, "Edited body.");
    const errors = (await lintMemory({ root })).issues.filter((issue) => issue.severity === "error");
    expect(errors).toEqual([expect.objectContaining({ path: "decisions/old.md" })]);
  });
});

describe("memory mv", () => {
  it("rewrites note-relative, root-relative, absolute and plain mentions of moved notes", () => {
    const table = new Map([
      ["decisions/policy.md", "codex/policy.md"],
      ["knowledge/self.md", "codex/self.md"],
    ]);
    const notePaths = new Set(["decisions/policy.md", "knowledge/self.md", "knowledge/sibling.md"]);
    const content = [
      "[a](../decisions/policy.md#why) [b](decisions/policy.md) [c](sibling.md)",
      `[d](file:${root}/decisions/policy.md:3) plain \`decisions/policy.md\` and decisions/policy.md.`,
      "[e](file:web/server/x.md) stays",
    ].join("\n");
    // The note itself moves from knowledge/ to codex/, so its sibling link must be recomputed too.
    const rewritten = rewriteMemoryReferences(content, "knowledge/self.md", "codex/self.md", table, root, notePaths);
    expect(rewritten).toBe(
      [
        "[a](policy.md#why) [b](codex/policy.md) [c](../knowledge/sibling.md)",
        `[d](file:${root}/codex/policy.md:3) plain \`codex/policy.md\` and codex/policy.md.`,
        "[e](file:web/server/x.md) stays",
      ].join("\n"),
    );
  });

  it("moves notes under the lock, keeps type, recency and helpful marks, and removes empty folders", async () => {
    await note("decisions/policy.md", 'description: "Read when policy."');
    await note("knowledge/user.md", 'description: "Read when user."', "Uses `decisions/policy.md`.");
    await commitAll("initial");
    await writeHelpfulMarks(root, { "decisions/policy.md": "2026-10-01" });

    await expect(moveMemoryNotes({ root }, [{ from: "decisions/policy.md", to: "codex/policy.md" }])).rejects.toThrow(
      "Acquire the memory repo lock",
    );
    await acquireMemoryLock({ root, owner: "test" });
    const result = await moveMemoryNotes({ root }, parseMovePlan("# plan\ndecisions/policy.md codex/policy.md\n"));

    expect(result).toEqual({ moved: 1, rewrittenNotes: 1 });
    const moved = await readFile(join(root, "codex/policy.md"), "utf-8");
    expect(moved).toMatch(/^type: decision$/m); // Legacy-folder type made explicit before leaving it.
    expect(moved).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m); // Git-date fallback made explicit.
    expect(await readFile(join(root, "knowledge/user.md"), "utf-8")).toContain("Uses `codex/policy.md`.");
    expect(await readHelpfulMarks(root)).toEqual({ "codex/policy.md": "2026-10-01" });
    await expect(stat(join(root, "decisions"))).rejects.toThrow();

    // A repair commit neither stamps `updated:` nor holds touched notes to the per-note rules.
    const before = moved.match(/^updated: .*$/m)?.[0];
    await commitMemory({
      root,
      message: "Move policy",
      operation: "repair",
      sources: ["q-1"],
      memoryIds: ["codex/policy.md"],
    });
    expect((await readFile(join(root, "codex/policy.md"), "utf-8")).match(/^updated: .*$/m)?.[0]).toBe(before);
  });

  it("rejects moves onto existing notes or outside a folder", async () => {
    await note("voice/a.md", 'description: "Read when a."\ntype: decision');
    await note("voice/b.md", 'description: "Read when b."\ntype: decision');
    await acquireMemoryLock({ root, owner: "test" });
    await expect(moveMemoryNotes({ root }, [{ from: "voice/a.md", to: "voice/b.md" }])).rejects.toThrow(
      "already exists",
    );
    await expect(moveMemoryNotes({ root }, [{ from: "voice/a.md", to: "a.md" }])).rejects.toThrow("<folder>/<name>.md");
    await expect(moveMemoryNotes({ root }, [{ from: "voice/a.md", to: ".git/a.md" }])).rejects.toThrow("hidden");
  });
});

describe("memory commit stamping", () => {
  it("stamps updated on substantively changed notes only", async () => {
    await note("voice/a.md", 'description: "Read when a."\ntype: decision\nupdated: 2020-01-01');
    await note("voice/b.md", 'description: "Read when b."\ntype: decision\nupdated: 2020-01-01');
    await commitAll("initial");
    await acquireMemoryLock({ root, owner: "test" });

    await note("voice/a.md", 'description: "Read when a."\ntype: decision\nupdated: 2020-01-01', "New fact.");
    await commitMemory({ root, message: "Edit a", sources: ["q-1"], memoryIds: ["voice/a.md"] });

    const entries = new Map((await scanMemoryCatalog({ root })).entries.map((entry) => [entry.path, entry]));
    expect(entries.get("voice/a.md")?.updated).not.toBe("2020-01-01");
    expect(entries.get("voice/b.md")?.updated).toBe("2020-01-01");
  });
});
