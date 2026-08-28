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
  it("keeps the trigger, format adaptation, and narrower-skill boundary explicit", async () => {
    // This guards the reusable design contract rather than one tutorial example:
    // substantial reader-facing explanations trigger the skill, while specialized
    // workflow and safety skills retain authority over their own required content.
    const [skill, formatGuide, editorialGuide, metadata, claudeDocs, agentsDocs] = await Promise.all([
      readFile(join(SKILL_ROOT, "SKILL.md"), "utf-8"),
      readFile(join(SKILL_ROOT, "references", "format-adaptation.md"), "utf-8"),
      readFile(join(SKILL_ROOT, "references", "editorial-rewrites.md"), "utf-8"),
      readFile(join(SKILL_ROOT, "agents", "openai.yaml"), "utf-8"),
      readFile(join(REPO_ROOT, "CLAUDE.md"), "utf-8"),
      readFile(join(REPO_ROOT, "AGENTS.md"), "utf-8"),
    ]);

    expect(skill).toMatch(/^---\nname: explain-clearly\ndescription: /);
    expect(skill).toContain("non-trivial user-facing explanation");
    expect(skill).toContain("multi-paragraph chat or Markdown, documents, reports, slide narratives");
    expect(skill).toContain("Skip the full workflow for trivial one-line replies");
    expect(skill).toContain("When a narrower authoritative skill governs the task");
    expect(skill).toContain("Progressive revelation is a principle, not an HTML widget");
    expect(skill).toContain("Remove or rewrite language that assumes hidden conversation");
    expect(skill).toContain("the available implementation");
    expect(skill).toContain("state the supported conceptual lesson first");
    expect(skill).toContain("the source audit support it rather than replace it");
    expect(skill).toContain("current mirror");
    expect(skill).toContain("Do not repeat a rigid “problem / idea / takeaway” scaffold");
    expect(skill).toContain("references/format-adaptation.md");
    expect(skill).toContain("references/editorial-rewrites.md");

    expect(formatGuide).toContain("## Chat and Conversational Answers");
    expect(formatGuide).toContain("## Markdown, Documents, and Reports");
    expect(formatGuide).toContain("## Slide Narratives");
    expect(formatGuide).toContain("## Interactive HTML and Tutorials");
    expect(formatGuide).toContain("When Not to Layer");

    expect(editorialGuide).toContain("Replace Hidden History with the Actual Point");
    expect(editorialGuide).toContain("Introduce Evidence Before Its Limitation");
    expect(editorialGuide).toContain("Avoid Mechanical Section Scaffolds");
    expect(editorialGuide).toContain("Whole-Surface Editorial Pass");

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
