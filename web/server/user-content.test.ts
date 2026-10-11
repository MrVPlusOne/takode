import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectUserLevelContent,
  readUserContentBundle,
  userContentStoreIsEmpty,
  userContentStoreSignature,
  userLevelPaths,
  writeImportedUserContent,
} from "./user-content.js";

// The coordinator's store and a machine's home live under a fresh temp root,
// so no test reads or writes a real home directory.
let root: string;
let store: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "user-content-test-"));
  store = join(root, "store");
  home = join(root, "home");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

const skillText = (name: string, description = "test") =>
  `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`;

describe("readUserContentBundle", () => {
  it("gives each backend the shared instructions followed by its own", async () => {
    await put(join(store, "instructions", "all.md"), "Shared rule\n");
    await put(join(store, "instructions", "claude.md"), "Claude rule");
    await put(join(store, "instructions", "codex.md"), "Codex rule");

    const { content } = await readUserContentBundle(store);

    expect(content.instructions).toEqual({ claude: "Shared rule\n\nClaude rule", codex: "Shared rule\n\nCodex rule" });
  });

  it("reads skill files with their modes, follows links and skips hidden files and folders without SKILL.md", async () => {
    await put(join(store, "skills", "all", "alpha", "SKILL.md"), skillText("alpha"));
    await put(join(store, "skills", "all", "alpha", "scripts", "run.sh"), "#!/bin/sh\n");
    await chmod(join(store, "skills", "all", "alpha", "scripts", "run.sh"), 0o755);
    await put(join(store, "skills", "all", "alpha", ".DS_Store"), "x");
    await put(join(store, "skills", "all", "not-a-skill", "notes.md"), "no SKILL.md here");
    // A store entry may link to a skill kept elsewhere, such as a personal skills repo.
    await put(join(root, "elsewhere", "beta", "SKILL.md"), skillText("beta"));
    await mkdir(join(store, "skills", "codex"), { recursive: true });
    await symlink(join(root, "elsewhere", "beta"), join(store, "skills", "codex", "beta"));

    const { content } = await readUserContentBundle(store);

    expect(content.skills.map((file) => `${file.scope}/${file.skill}/${file.path}`)).toEqual([
      "all/alpha/SKILL.md",
      "all/alpha/scripts/run.sh",
      "codex/beta/SKILL.md",
    ]);
    expect(content.skills[1].mode).toBe(0o755);
  });

  it("changes its hash, and the store signature, when content changes", async () => {
    await put(join(store, "skills", "all", "alpha", "SKILL.md"), skillText("alpha"));
    const before = await readUserContentBundle(store);
    const signature = await userContentStoreSignature(store);
    expect((await readUserContentBundle(store)).hash).toBe(before.hash);

    await put(join(store, "instructions", "all.md"), "New rule");

    expect((await readUserContentBundle(store)).hash).not.toBe(before.hash);
    expect(await userContentStoreSignature(store)).not.toBe(signature);
  });

  it("treats a missing or contentless store as empty, and reports no signature without a store", async () => {
    expect(await userContentStoreIsEmpty(store)).toBe(true);
    expect(await userContentStoreSignature(store)).toBeNull();
    await mkdir(join(store, "skills", "all"), { recursive: true });
    expect(await userContentStoreIsEmpty(store)).toBe(true);
  });
});

describe("one-time import", () => {
  const paths = () => userLevelPaths(home);

  it("imports one shared file when both backends read the same instructions, and sorts skills by backend", async () => {
    await put(paths().claudeInstructions, "Same rules\n");
    // Codex reading the same file through a link counts as the same instructions.
    await mkdir(join(home, ".codex"), { recursive: true });
    await symlink(paths().claudeInstructions, paths().codexInstructions);
    await put(join(paths().claudeSkills, "both", "SKILL.md"), skillText("both"));
    await put(join(paths().agentsSkills, "both", "SKILL.md"), skillText("both"));
    await put(join(paths().claudeSkills, "only-claude", "SKILL.md"), skillText("only-claude"));
    await put(join(paths().agentsSkills, "differs", "SKILL.md"), skillText("differs", "codex"));
    await put(join(paths().claudeSkills, "differs", "SKILL.md"), skillText("differs", "claude"));
    // Takode's own skills and links Takode created are not the user's to import.
    await put(join(paths().claudeSkills, "quest", "SKILL.md"), skillText("quest"));
    await put(join(root, "installed", "skills", "all", "delivered", "SKILL.md"), skillText("delivered"));
    await symlink(join(root, "installed", "skills", "all", "delivered"), join(paths().agentsSkills, "delivered"));

    const collected = await collectUserLevelContent(["quest"], join(root, "installed") + sep, paths());
    const summary = await writeImportedUserContent(collected, store);

    expect(summary.instructionFiles).toEqual(["all.md"]);
    expect(await readFile(join(store, "instructions", "all.md"), "utf-8")).toBe("Same rules\n");
    expect(summary.skills.sort()).toEqual(["all/both", "claude/differs", "claude/only-claude", "codex/differs"]);
    expect(collected.skipped.some((entry) => entry.includes("quest"))).toBe(true);
    expect(collected.skipped.some((entry) => entry.includes("delivered"))).toBe(true);
  });

  it("keeps each backend's file separately when their instructions differ", async () => {
    await put(paths().claudeInstructions, "Claude rules");
    await put(paths().codexInstructions, "Codex rules");

    const summary = await writeImportedUserContent(
      await collectUserLevelContent([], join(root, "installed") + sep, paths()),
      store,
    );

    expect(summary.instructionFiles).toEqual(["claude.md", "codex.md"]);
    expect((await readUserContentBundle(store)).content.instructions).toEqual({
      claude: "Claude rules",
      codex: "Codex rules",
    });
  });
});
