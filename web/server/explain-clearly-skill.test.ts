import { access, mkdtemp, mkdir, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSkillSymlinks } from "./skill-symlink.js";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, "..", "..");
const SKILL_ROOT = join(REPO_ROOT, ".claude", "skills", "explain-clearly");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("explain-clearly project skill", () => {
  it("keeps the trigger, concise preferences, and anti-pattern boundary explicit", async () => {
    // This guards the user-approved high-level preference without turning one
    // explanation format or technique into a required workflow for future agents.
    const [skill, metadata, claudeDocs, agentsDocs] = await Promise.all([
      readFile(join(SKILL_ROOT, "SKILL.md"), "utf-8"),
      readFile(join(SKILL_ROOT, "agents", "openai.yaml"), "utf-8"),
      readFile(join(REPO_ROOT, "CLAUDE.md"), "utf-8"),
      readFile(join(REPO_ROOT, "AGENTS.md"), "utf-8"),
    ]);

    expect(skill).toMatch(/^---\nname: explain-clearly\ndescription: /);
    expect(skill).toContain("substantial user-facing explanation");
    expect(skill).toContain("high-level preferences, not a required workflow or template");
    expect(skill).toContain("natural and easy to read and follow");
    expect(skill).toContain("actual audience");
    expect(skill).toContain("self-contained for a fresh reader");
    expect(skill).toContain("core idea, answer, or mental model");
    expect(skill).toContain("Layer secondary detail");
    expect(skill).toContain("Adapt the depth and presentation to the medium and context");

    expect(skill).toContain("AI-ish, canned, or repetitive templating");
    expect(skill).toContain("Audit-log, revision-history, or internal-workflow framing");
    expect(skill).toContain("Dependence on prior conversation or other hidden history");
    expect(skill).toContain("Coding-agent language when it is irrelevant");
    expect(skill).toContain("Unexplained or out-of-context details");
    expect(skill).toContain("Excessive information dumping");

    expect(skill).toContain(
      "Leave implementation choices, exact structure, interaction techniques, and workflow design to the agent",
    );
    expect(skill).toContain("When a narrower skill governs workflow");
    expect(skill).not.toContain("references/format-adaptation.md");
    expect(skill).not.toContain("references/editorial-rewrites.md");
    await expect(access(join(SKILL_ROOT, "references", "format-adaptation.md"))).rejects.toThrow();
    await expect(access(join(SKILL_ROOT, "references", "editorial-rewrites.md"))).rejects.toThrow();

    expect(metadata).toContain('display_name: "Explain Clearly"');
    expect(metadata).toContain('short_description: "Write natural, audience-aware explanations"');
    expect(metadata).toContain("Use $explain-clearly");

    for (const docs of [claudeDocs, agentsDocs]) {
      expect(docs).toContain("`explain-clearly`");
      expect(docs).toContain(".claude/skills/explain-clearly/");
    }
  });

  it("distributes one canonical Claude source to both supported skill homes", async () => {
    // Takode deliberately falls back from the repo's Claude source for non-Claude
    // agents. This temp-only integration check prevents an unnecessary divergent
    // .agents or legacy .codex copy from becoming the canonical implementation.
    const root = await mkdtemp(join(tmpdir(), "takode-explain-clearly-"));
    tempRoots.push(root);
    const claudeSkillsHome = join(root, "home", ".claude", "skills");
    const agentsSkillsHome = join(root, "home", ".agents", "skills");
    const legacyCodexSkillsHome = join(root, "home", ".codex", "skills");
    await Promise.all([
      mkdir(claudeSkillsHome, { recursive: true }),
      mkdir(agentsSkillsHome, { recursive: true }),
      mkdir(legacyCodexSkillsHome, { recursive: true }),
    ]);

    await ensureSkillSymlinks([], {
      mainRepoRoot: REPO_ROOT,
      claudeSkillsHome,
      agentsSkillsHome,
      legacyCodexSkillsHome,
    });

    expect(await readlink(join(claudeSkillsHome, "explain-clearly"))).toBe(SKILL_ROOT);
    expect(await readlink(join(agentsSkillsHome, "explain-clearly"))).toBe(SKILL_ROOT);
    await expect(access(join(REPO_ROOT, ".agents", "skills", "explain-clearly"))).rejects.toThrow();
    await expect(access(join(REPO_ROOT, ".codex", "skills", "explain-clearly"))).rejects.toThrow();

    const indexSource = await readFile(join(SERVER_DIR, "index.ts"), "utf-8");
    const startupMatch = indexSource.match(/STARTUP_SKILL_SYMLINKS = \[([\s\S]*?)\];/);
    expect(startupMatch).toBeTruthy();
    expect(startupMatch![1]).not.toContain('"explain-clearly"');
  });
});
