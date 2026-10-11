import { access, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ensureSkillSymlinks, GLOBAL_SKILL_SLUGS } from "./skill-symlink.js";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, "..", "..");
const QUEST_JOURNEY_SKILL_SLUGS = [
  "quest-journey-alignment",
  "quest-journey-explore",
  "quest-journey-implement",
  "quest-journey-code-review",
  "quest-journey-mental-simulation",
  "quest-journey-execute",
  "quest-journey-outcome-review",
  "quest-journey-user-checkpoint",
  "quest-journey-bookkeeping",
  "quest-journey-port",
  "quest-journey-planning",
  "quest-journey-implementation",
  "quest-journey-skeptic-review",
  "quest-journey-reviewer-groom",
  "quest-journey-porting",
];

describe("index startup skill registration", () => {
  it("registers canonical global skills without stale hardcoded slugs", async () => {
    // If a nonexistent project skill is reintroduced here, startup will recreate
    // warning spam and potentially broken symlink state. Guard the actual
    // GLOBAL_SKILL_SLUGS list that startup links into the global skill homes.
    const registered = [...GLOBAL_SKILL_SLUGS];
    for (const slug of registered) {
      const skill = await readFile(join(REPO_ROOT, ".claude", "skills", slug, "SKILL.md"), "utf-8");
      expect(skill).toMatch(new RegExp(`^name: ${slug}$`, "m"));
    }

    expect(registered).not.toContain("cron-scheduling");
    expect(registered).toContain("takode-orchestration");
    expect(registered).toContain("leader-dispatch");
    expect(registered).toContain("leader-decision-communication");
    expect(registered).toContain("confirm");
    expect(registered).not.toContain("quest-journey-planning");
    expect(registered).not.toContain("quest-journey-explore");
    expect(registered).not.toContain("quest-journey-implement");
    expect(registered).not.toContain("quest-journey-code-review");
    expect(registered).not.toContain("quest-journey-mental-simulation");
    expect(registered).not.toContain("quest-journey-execute");
    expect(registered).not.toContain("quest-journey-outcome-review");
    expect(registered).not.toContain("quest-journey-user-checkpoint");
    expect(registered).not.toContain("quest-journey-bookkeeping");
    expect(registered).not.toContain("quest-journey-port");
    expect(registered).not.toContain("quest-journey-implementation");
    expect(registered).not.toContain("quest-journey-skeptic-review");
    expect(registered).not.toContain("quest-journey-reviewer-groom");
    expect(registered).not.toContain("quest-journey-porting");
    expect(registered).toContain("self-groom");
    expect(registered).toContain("reviewer-groom");
    expect(registered).toContain("skeptic-review");
    expect(registered).toContain("worktree-rules");
    expect(registered).toContain("quest-design");
    expect(registered).toContain("takode-user-content");
    expect(registered).not.toContain("playwright-e2e-tester");
  });

  it("does not keep Quest Journey phase skills as repo skill sources or documented installed skills", async () => {
    const docs = await Promise.all([
      readFile(join(REPO_ROOT, "CLAUDE.md"), "utf-8"),
      readFile(join(REPO_ROOT, "AGENTS.md"), "utf-8"),
    ]);

    for (const slug of QUEST_JOURNEY_SKILL_SLUGS) {
      await expect(access(join(REPO_ROOT, ".claude", "skills", slug, "SKILL.md"))).rejects.toThrow();
      for (const doc of docs) {
        expect(doc).not.toContain(slug);
      }
    }

    for (const doc of docs) {
      expect(doc).toContain("~/.companion/quest-journey-phases/<phase-id>/");
    }
  });

  it.each([
    "takode-orchestration-design",
    "leader-decision-communication",
  ])("keeps %s discoverable from its canonical source", async (slug) => {
    // Preserve identity, discoverability, and source ownership without copying
    // the design/communication policy or its examples into assertions. A Codex
    // project entry may only link to the canonical source, never be a copy.
    const relativeRoot = `.claude/skills/${slug}`;
    const skill = await readFile(join(REPO_ROOT, relativeRoot, "SKILL.md"), "utf-8");
    expect(skill).toMatch(new RegExp(`^name: ${slug}$`, "m"));
    for (const filename of ["CLAUDE.md", "AGENTS.md"]) {
      expect(await readFile(join(REPO_ROOT, filename), "utf-8")).toContain(`${relativeRoot}/`);
    }
    const agentsEntry = join(REPO_ROOT, ".agents", "skills", slug);
    const isLink = await lstat(agentsEntry).then(
      (entry) => entry.isSymbolicLink(),
      () => null,
    );
    if (isLink !== null) {
      expect(isLink).toBe(true);
      expect(await realpath(agentsEntry)).toBe(await realpath(join(REPO_ROOT, relativeRoot)));
    }
    await expect(access(join(REPO_ROOT, ".codex", "skills", slug, "SKILL.md"))).rejects.toThrow();
  });

  it("loads every development skill as a project skill for Claude and Codex, never globally", async () => {
    // Skills about developing Takode must reach sessions working inside the repo
    // and no others. Claude reads the repo's .claude/skills itself; Codex reads only
    // .agents/skills, so each such skill needs an entry there. Startup must not link
    // any of them into the global homes. The UI/E2E skill also keeps its Codex
    // UI metadata reachable through the shared source.
    const repoSkills = async (directory: string) =>
      (await readdir(join(REPO_ROOT, directory, "skills"))).filter((name) => !name.startsWith("."));
    const global = new Set<string>(GLOBAL_SKILL_SLUGS);
    const development = [...new Set([...(await repoSkills(".claude")), ...(await repoSkills(".agents"))])].filter(
      (slug) => !global.has(slug),
    );
    expect(development).toContain("takode-ui-e2e-validation");
    for (const slug of development) {
      const skill = await readFile(join(REPO_ROOT, ".agents", "skills", slug, "SKILL.md"), "utf-8");
      expect(skill).toMatch(new RegExp(`^name: ${slug}$`, "m"));
    }
    const codexMetadata = await readFile(
      join(REPO_ROOT, ".agents", "skills", "takode-ui-e2e-validation", "agents", "openai.yaml"),
      "utf-8",
    );
    expect(codexMetadata).toContain("interface:");

    const homes = await mkdtemp(join(tmpdir(), "takode-skill-homes-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await ensureSkillSymlinks(GLOBAL_SKILL_SLUGS, {
        mainRepoRoot: REPO_ROOT,
        claudeSkillsHome: join(homes, "claude"),
        agentsSkillsHome: join(homes, "agents"),
        legacyCodexSkillsHome: join(homes, "codex"),
      });
      for (const home of ["claude", "agents"]) {
        const installed = await readdir(join(homes, home));
        expect(installed.filter((slug) => development.includes(slug))).toEqual([]);
        expect(installed).toContain("takode-orchestration");
      }
    } finally {
      log.mockRestore();
      await rm(homes, { recursive: true, force: true });
    }
  });

  it("documents executable full-gate commands using the no-install package runner", async () => {
    // Omitting `run` selects Bun's built-in test runner instead of this repo's
    // Vitest script; omitting --no-install permits unintended dependency setup.
    for (const filename of ["CLAUDE.md", "AGENTS.md", "web/server/templates/quest-skill-docs.md"]) {
      const source = await readFile(join(REPO_ROOT, filename), "utf-8");
      for (const script of ["typecheck", "test", "format:check"]) {
        expect(source).toContain(`bun --no-install run ${script}`);
      }
    }
  });
});
