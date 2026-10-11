import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUserContentBundle, type UserContentStore } from "./user-content.js";
import {
  defaultMachineRoots,
  installUserContent,
  type UserContentInstallRequest,
  type UserContentMachineRoots,
} from "./user-content-install.js";

// A coordinator store and one machine's home, both under a fresh temp root.
let root: string;
let store: UserContentStore;
let roots: UserContentMachineRoots;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "user-content-install-test-"));
  store = { instructions: join(root, "user-instructions"), skills: join(root, "user-skills") };
  roots = defaultMachineRoots(join(root, "home"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function skill(scope: string, name: string, description = "test") {
  await put(join(store.skills, scope, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nB\n`);
}

async function deliver(extra: Partial<UserContentInstallRequest> = {}) {
  const bundle = await readUserContentBundle(store);
  return installUserContent({ hash: bundle.hash, content: bundle.content, takodeSkills: [], ...extra }, roots);
}

const exists = async (path: string) => (await lstat(path).catch(() => null)) !== null;

describe("instruction files", () => {
  it("writes each backend's file where none exists, and asks for content when its copy is stale", async () => {
    await put(join(store.instructions, "all.md"), "Shared");
    await put(join(store.instructions, "codex.md"), "Codex only");
    const bundle = await readUserContentBundle(store);
    const request = { hash: bundle.hash, content: null, takodeSkills: [] };
    expect((await installUserContent(request, roots)).status).toBe("needs-files");

    const result = await deliver();

    expect(result.instructionFiles.map((file) => file.state)).toEqual(["written", "written"]);
    expect(await readFile(roots.paths.claudeInstructions, "utf-8")).toBe("Shared\n");
    expect(await readFile(roots.paths.codexInstructions, "utf-8")).toBe("Shared\n\nCodex only\n");
  });

  it("never replaces the user's own file or a link without approval", async () => {
    await put(join(store.instructions, "all.md"), "From the store");
    await put(roots.paths.claudeInstructions, "The user's own rules");
    await mkdir(join(roots.paths.codexInstructions, ".."), { recursive: true });
    await symlink(roots.paths.claudeInstructions, roots.paths.codexInstructions);

    const result = await deliver();

    expect(result.instructionFiles.map((file) => file.state)).toEqual(["conflict", "conflict"]);
    expect(await readFile(roots.paths.claudeInstructions, "utf-8")).toBe("The user's own rules");
    expect((await lstat(roots.paths.codexInstructions)).isSymbolicLink()).toBe(true);
    expect(result.backupDir).toBeUndefined();
  });

  it("replaces them after the user approves a take-over, backing each up first", async () => {
    await put(join(store.instructions, "all.md"), "From the store");
    await put(roots.paths.claudeInstructions, "The user's own rules");
    await mkdir(join(roots.paths.codexInstructions, ".."), { recursive: true });
    await symlink(roots.paths.claudeInstructions, roots.paths.codexInstructions);

    const result = await deliver({ takeOver: true });

    expect(result.instructionFiles.map((file) => file.state)).toEqual(["taken-over", "taken-over"]);
    expect(await readFile(roots.paths.claudeInstructions, "utf-8")).toBe("From the store\n");
    // The link is replaced by Takode's own file rather than written through.
    expect((await lstat(roots.paths.codexInstructions)).isFile()).toBe(true);
    const [claudeFile, codexFile] = result.instructionFiles;
    expect(await readFile(claudeFile.backup!, "utf-8")).toBe("The user's own rules");
    expect(await readlink(codexFile.backup!)).toBe(roots.paths.claudeInstructions);
  });

  it("labels why each waiting file differs", async () => {
    await put(join(store.instructions, "all.md"), "Rules v1");
    await deliver();
    await writeFile(roots.paths.claudeInstructions, "Rules v1 plus a local edit\n");
    await mkdir(join(roots.paths.codexInstructions, ".."), { recursive: true });
    await rm(roots.paths.codexInstructions);
    await put(join(root, "elsewhere.md"), "Other rules");
    await symlink(join(root, "elsewhere.md"), roots.paths.codexInstructions);

    const details = (await deliver()).instructionFiles.map((file) => file.detail);

    expect(details).toEqual([
      "edited by hand after Takode wrote it",
      `a link to ${join(root, "elsewhere.md")}, differs from the store`,
    ]);
  });

  it("replaces, without approval but with a backup, a link whose file already holds the store's text", async () => {
    // Nothing is lost, so the user is not asked: the laptop's AGENTS.md -> CLAUDE.md link is this case.
    await put(join(store.instructions, "all.md"), "Same rules");
    await put(roots.paths.claudeInstructions, "Same rules\n");
    await mkdir(join(roots.paths.codexInstructions, ".."), { recursive: true });
    await symlink(roots.paths.claudeInstructions, roots.paths.codexInstructions);

    const [claude, codex] = (await deliver()).instructionFiles;

    expect(claude.state).toBe("current");
    expect(codex).toMatchObject({ state: "taken-over", detail: "same as the store" });
    expect((await lstat(roots.paths.codexInstructions)).isFile()).toBe(true);
    expect(await readlink(codex.backup!)).toBe(roots.paths.claudeInstructions);
  });

  it("adopts a file that already has the store's content, then updates it with a backup when the store changes", async () => {
    await put(join(store.instructions, "all.md"), "Rules v1");
    await put(roots.paths.claudeInstructions, "Rules v1\n");
    expect((await deliver()).instructionFiles[0].state).toBe("current");

    await put(join(store.instructions, "all.md"), "Rules v2");
    const result = await deliver();

    expect(result.instructionFiles[0].state).toBe("updated");
    expect(await readFile(roots.paths.claudeInstructions, "utf-8")).toBe("Rules v2\n");
    expect(await readFile(result.instructionFiles[0].backup!, "utf-8")).toBe("Rules v1\n");
  });

  it("treats a hand edit of Takode's file as the user's own again", async () => {
    await put(join(store.instructions, "all.md"), "Rules v1");
    await deliver();
    await writeFile(roots.paths.claudeInstructions, "Rules v1\nPlus a local edit\n");

    await put(join(store.instructions, "all.md"), "Rules v2");
    const result = await deliver();

    expect(result.instructionFiles[0].state).toBe("conflict");
    expect(await readFile(roots.paths.claudeInstructions, "utf-8")).toContain("local edit");
  });

  it("removes Takode's file, backed up, when the store no longer has instructions, but leaves the user's", async () => {
    await put(join(store.instructions, "claude.md"), "Claude rules");
    await put(roots.paths.codexInstructions, "The user's Codex rules");
    await deliver();
    await rm(join(store.instructions, "claude.md"));

    const result = await deliver();

    expect(result.instructionFiles.map((file) => file.state)).toEqual(["removed", "unmanaged"]);
    expect(await exists(roots.paths.claudeInstructions)).toBe(false);
    expect(await readFile(roots.paths.codexInstructions, "utf-8")).toBe("The user's Codex rules");
  });

  it("notes an AGENTS.override.md, which Codex reads instead of AGENTS.md", async () => {
    await put(join(roots.paths.codexInstructions, "..", "AGENTS.override.md"), "override");
    expect((await deliver()).notes[0]).toContain("AGENTS.override.md");
  });
});

describe("skills", () => {
  it("links shared skills for both backends and each backend's own skills only for that backend", async () => {
    await skill("all", "shared");
    await skill("claude", "claude-only");
    await skill("codex", "codex-only");
    // A backend's own version replaces the shared one of the same name for that backend.
    await skill("claude", "shared", "claude version");

    await deliver();

    const { installRoot, paths } = roots;
    expect(await readlink(join(paths.claudeSkills, "shared"))).toBe(join(installRoot, "skills", "claude", "shared"));
    expect(await readlink(join(paths.agentsSkills, "shared"))).toBe(join(installRoot, "skills", "all", "shared"));
    expect(await exists(join(paths.claudeSkills, "codex-only"))).toBe(false);
    expect(await exists(join(paths.agentsSkills, "claude-only"))).toBe(false);
    expect(await readFile(join(paths.claudeSkills, "shared", "SKILL.md"), "utf-8")).toContain("claude version");
  });

  it("lets a Takode skill of the same name win and leaves the user's entries until a take-over", async () => {
    await skill("all", "confirm");
    await skill("all", "mine");
    await put(join(roots.paths.claudeSkills, "confirm", "SKILL.md"), "Takode's confirm");
    await mkdir(roots.paths.agentsSkills, { recursive: true });
    await symlink("/somewhere/else/mine", join(roots.paths.agentsSkills, "mine"));

    const result = await deliver({ takodeSkills: ["confirm"] });

    expect(result.skills.shadowedByTakode.length).toBe(2);
    expect(result.skills.conflicts).toEqual([
      { path: join(roots.paths.agentsSkills, "mine"), detail: "differs from the store" },
    ]);
    expect(await readFile(join(roots.paths.claudeSkills, "confirm", "SKILL.md"), "utf-8")).toBe("Takode's confirm");
    expect(await readlink(join(roots.paths.agentsSkills, "mine"))).toBe("/somewhere/else/mine");

    const approved = await deliver({ takodeSkills: ["confirm"], takeOver: true });

    expect(approved.skills.takenOver).toEqual([join(roots.paths.agentsSkills, "mine")]);
    expect(await readlink(join(roots.paths.agentsSkills, "mine"))).toBe(
      join(roots.installRoot, "skills", "all", "mine"),
    );
    // The replaced entry is kept, as it was, in the run's backup folder.
    expect(await readlink(join(approved.backupDir!, "skills-agents", "mine"))).toBe("/somewhere/else/mine");
    expect(await readFile(join(roots.paths.claudeSkills, "confirm", "SKILL.md"), "utf-8")).toBe("Takode's confirm");
  });

  it("replaces a skill entry with exactly the store's files without approval, keeping it in the backup", async () => {
    await skill("all", "same");
    await put(join(roots.paths.claudeSkills, "same", "SKILL.md"), "---\nname: same\ndescription: test\n---\nB\n");

    const result = await deliver();

    expect(result.skills.conflicts).toEqual([]);
    expect(result.skills.takenOver).toEqual([join(roots.paths.claudeSkills, "same")]);
    expect(await readlink(join(roots.paths.claudeSkills, "same"))).toBe(
      join(roots.installRoot, "skills", "all", "same"),
    );
    expect(await readFile(join(result.backupDir!, "skills-claude", "same", "SKILL.md"), "utf-8")).toContain(
      "name: same",
    );
  });

  it("changes nothing on disk when everything is already current", async () => {
    // Codex watches its skill folders, so an up-to-date delivery must not rewrite them.
    await skill("all", "alpha");
    await put(join(store.instructions, "all.md"), "Rules");
    await deliver();
    const before = {
      copy: (await stat(join(roots.installRoot, "skills", "all", "alpha", "SKILL.md"))).mtimeMs,
      link: (await lstat(join(roots.paths.agentsSkills, "alpha"))).mtimeMs,
      file: (await stat(roots.paths.claudeInstructions)).mtimeMs,
      ownership: (await stat(roots.ownershipFile)).mtimeMs,
    };

    const bundle = await readUserContentBundle(store);
    const result = await installUserContent({ hash: bundle.hash, content: null, takodeSkills: [] }, roots);

    expect(result.status).toBe("current");
    expect(result.instructionFiles.map((file) => file.state)).toEqual(["current", "current"]);
    expect(result.skills.linked).toEqual([]);
    expect({
      copy: (await stat(join(roots.installRoot, "skills", "all", "alpha", "SKILL.md"))).mtimeMs,
      link: (await lstat(join(roots.paths.agentsSkills, "alpha"))).mtimeMs,
      file: (await stat(roots.paths.claudeInstructions)).mtimeMs,
      ownership: (await stat(roots.ownershipFile)).mtimeMs,
    }).toEqual(before);
  });

  it("refreshes edited skills, removes links of deleted ones and leaves no staging folders behind", async () => {
    await skill("all", "keep");
    await skill("all", "drop");
    await deliver();
    await rm(join(store.skills, "all", "drop"), { recursive: true });
    await skill("all", "keep", "edited");

    const result = await deliver();

    expect(result.status).toBe("installed");
    expect(result.skills.removed.sort()).toEqual(
      [join(roots.paths.claudeSkills, "drop"), join(roots.paths.agentsSkills, "drop")].sort(),
    );
    expect(await readFile(join(roots.paths.claudeSkills, "keep", "SKILL.md"), "utf-8")).toContain("edited");
    const companion = join(root, "home", ".companion");
    expect((await readdir(companion)).filter((name) => name.startsWith("user-content-installed"))).toEqual([
      "user-content-installed",
    ]);
  });

  it("rejects file paths that would escape the skill folder", async () => {
    const content = {
      instructions: { claude: "", codex: "" },
      skills: [{ scope: "all" as const, skill: "evil", path: "../../outside.md", mode: 0o644, content: "" }],
    };
    await expect(installUserContent({ hash: "h", content, takodeSkills: [] }, roots)).rejects.toThrow(
      /Bad skill file path/,
    );
  });
});
