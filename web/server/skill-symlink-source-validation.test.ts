import { afterEach, describe, expect, it } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureSkillSymlinks, type SkillSymlinkRoots } from "./skill-symlink.js";

const tempRoots: string[] = [];
const PROJECT_ROOT = resolve(__dirname, "..", "..");

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeInstallation(): Promise<{
  root: string;
  repoClaudeHome: string;
  repoAgentsHome: string;
  installedAgentsHome: string;
  roots: SkillSymlinkRoots;
}> {
  const root = await mkdtemp(join(tmpdir(), "skill-source-validation-"));
  tempRoots.push(root);
  const mainRepoRoot = join(root, "repo");
  const repoClaudeHome = join(mainRepoRoot, ".claude", "skills");
  const repoAgentsHome = join(mainRepoRoot, ".agents", "skills");
  const installedAgentsHome = join(root, "home", ".agents", "skills");
  const roots = {
    mainRepoRoot,
    claudeSkillsHome: join(root, "home", ".claude", "skills"),
    agentsSkillsHome: installedAgentsHome,
    legacyCodexSkillsHome: join(root, "home", ".codex", "skills"),
  };
  await Promise.all([mkdir(repoClaudeHome, { recursive: true }), mkdir(repoAgentsHome, { recursive: true })]);
  return { root, repoClaudeHome, repoAgentsHome, installedAgentsHome, roots };
}

async function writeSkill(skillsHome: string, slug: string, content: string): Promise<string> {
  const skillDir = join(skillsHome, slug);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
  return skillDir;
}

function validSkillContent(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Test ${name}\n---\n\n# ${body}\n`;
}

describe("skill source payload validation", () => {
  it("falls back from an empty agent source and exposes the canonical skill through the installed path", async () => {
    // This exercises the real filesystem path selection in disposable roots and
    // proves the installed non-Claude link exposes the current canonical guidance.
    const installation = await makeInstallation();
    const slug = "orchestration-guide";
    const canonicalContent = await readFile(
      join(PROJECT_ROOT, ".claude", "skills", "takode-orchestration", "SKILL.md"),
      "utf-8",
    );
    const canonicalDir = await writeSkill(installation.repoClaudeHome, slug, canonicalContent);
    await mkdir(join(installation.repoAgentsHome, slug), { recursive: true });

    await ensureSkillSymlinks([slug], installation.roots);

    const installedDir = join(installation.installedAgentsHome, slug);
    expect((await lstat(installedDir)).isSymbolicLink()).toBe(true);
    expect(await readlink(installedDir)).toBe(canonicalDir);
    expect(await readFile(join(installedDir, "SKILL.md"), "utf-8")).toContain(
      "One fresh reply may make one exact substitution",
    );
  });

  it("fails over for missing, blank, malformed, non-file, and broken agent payloads", async () => {
    // Each invalid source shape must select the populated canonical source
    // without probing or mutating any real global skill installation.
    const installation = await makeInstallation();
    const slugs = [
      "missing-payload",
      "blank-payload",
      "malformed-payload",
      "missing-metadata",
      "missing-body",
      "non-file-payload",
      "broken-source",
    ];
    const canonicalDirs = new Map<string, string>();
    for (const slug of slugs) {
      canonicalDirs.set(slug, await writeSkill(installation.repoClaudeHome, slug, validSkillContent(slug, slug)));
    }
    await writeSkill(installation.repoAgentsHome, "blank-payload", "  \n");
    await writeSkill(installation.repoAgentsHome, "malformed-payload", "# Missing skill frontmatter\n");
    await writeSkill(
      installation.repoAgentsHome,
      "missing-metadata",
      "---\nname: missing-metadata\n---\n\n# Missing description\n",
    );
    await writeSkill(
      installation.repoAgentsHome,
      "missing-body",
      "---\nname: missing-body\ndescription: Missing body\n---\n",
    );
    await mkdir(join(installation.repoAgentsHome, "non-file-payload", "SKILL.md"), { recursive: true });
    await symlink(join(installation.root, "missing-source"), join(installation.repoAgentsHome, "broken-source"));

    await ensureSkillSymlinks(slugs, installation.roots);

    for (const slug of slugs) {
      const installedDir = join(installation.installedAgentsHome, slug);
      expect((await lstat(installedDir)).isSymbolicLink()).toBe(true);
      expect(await readlink(installedDir)).toBe(canonicalDirs.get(slug));
      expect(await readFile(join(installedDir, "SKILL.md"), "utf-8")).toContain(`# ${slug}`);
    }
  });

  it("preserves precedence for a valid distinct agent source", async () => {
    // A readable, nonblank regular SKILL.md remains an intentional non-Claude override.
    const installation = await makeInstallation();
    const slug = "distinct-guide";
    await writeSkill(installation.repoClaudeHome, slug, validSkillContent(slug, "Canonical guide"));
    const agentContent = validSkillContent(slug, "Distinct agent guide");
    const agentDir = await writeSkill(installation.repoAgentsHome, slug, agentContent);

    await ensureSkillSymlinks([slug], installation.roots);

    const installedDir = join(installation.installedAgentsHome, slug);
    expect(await readlink(installedDir)).toBe(agentDir);
    expect(await readFile(join(installedDir, "SKILL.md"), "utf-8")).toBe(agentContent);
  });
});
