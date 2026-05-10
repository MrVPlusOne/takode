import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(SERVER_DIR, "index.ts");
const ORCHESTRATION_DESIGN_SKILL_PATH = join(
  SERVER_DIR,
  "..",
  "..",
  ".claude",
  "skills",
  "takode-orchestration-design",
  "SKILL.md",
);
const SKEPTIC_REVIEW_SKILL_PATH = join(SERVER_DIR, "..", "..", ".claude", "skills", "skeptic-review", "SKILL.md");
const WORKTREE_RULES_SKILL_PATH = join(SERVER_DIR, "..", "..", ".claude", "skills", "worktree-rules", "SKILL.md");
const LEADER_DISPATCH_SKILL_PATH = join(SERVER_DIR, "..", "..", ".claude", "skills", "leader-dispatch", "SKILL.md");
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
  it("registers canonical startup skills without stale hardcoded slugs", async () => {
    // q-275: if a nonexistent project skill is reintroduced here, startup will
    // recreate warning spam and potentially broken symlink state. Guard the
    // actual ensureSkillSymlinks(...) registration list in index.ts directly.
    const source = await readFile(INDEX_PATH, "utf-8");
    const match = source.match(/ensureSkillSymlinks\(\[([\s\S]*?)\]\);/);
    expect(match).toBeTruthy();

    const registered = [...match![1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);

    expect(registered).not.toContain("cron-scheduling");
    expect(registered).toContain("takode-orchestration");
    expect(registered).toContain("leader-dispatch");
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
      expect(doc).toContain("Avoid adding global skills for context-dependent instructions");
      expect(doc).toContain(
        "Historical and canonical phase skill slugs remain internal Quest Journey compatibility metadata only",
      );
    }
  });

  it("documents a narrow orchestration design placement skill", async () => {
    const [skill, claudeDocs, agentsDocs] = await Promise.all([
      readFile(ORCHESTRATION_DESIGN_SKILL_PATH, "utf-8"),
      readFile(join(REPO_ROOT, "CLAUDE.md"), "utf-8"),
      readFile(join(REPO_ROOT, "AGENTS.md"), "utf-8"),
    ]);

    expect(skill).toContain("name: takode-orchestration-design");
    expect(skill).toContain("Use when designing, reviewing, or changing Takode");
    expect(skill).toContain("Do not use for ordinary quest execution");
    expect(skill).toContain("Placement Rubric");
    expect(skill).toContain("Source-Of-Truth Check");
    expect(skill).toContain("Avoid new project skills under legacy `.codex/skills`");
    expect(skill).toContain("Leader-specific deltas");
    expect(skill).not.toContain("quest-journey-implement");

    for (const docs of [claudeDocs, agentsDocs]) {
      expect(docs).toContain("`takode-orchestration-design`");
      expect(docs).toContain(".claude/skills/takode-orchestration-design/");
    }

    await expect(
      access(join(REPO_ROOT, ".agents", "skills", "takode-orchestration-design", "SKILL.md")),
    ).rejects.toThrow();
    await expect(
      access(join(REPO_ROOT, ".codex", "skills", "takode-orchestration-design", "SKILL.md")),
    ).rejects.toThrow();
  });

  it("keeps leader handoffs focused on phase-specific deltas", async () => {
    const source = await readFile(LEADER_DISPATCH_SKILL_PATH, "utf-8");

    expect(source).toContain("Memory command mechanics live in the relevant phase briefs");
    expect(source).toContain("include only memory-specific deltas");
    expect(source).toContain("The Port assignee brief owns the standard report shape");
    expect(source).toContain("Your handoff should add only context-dependent deltas");
    expect(source).toContain("Leader-specific deltas for this port");
  });

  it("keeps skeptic-review summary creation guidance from teaching lossy long summaries", async () => {
    const source = await readFile(SKEPTIC_REVIEW_SKILL_PATH, "utf-8");

    expect(source).toContain('quest feedback add <quest_id> --text "Summary: ..."');
    expect(source).toContain("--text-file /tmp/summary.md");
    expect(source).toContain("--tldr-file /tmp/summary-tldr.md");
    expect(source).toContain("for long multi-topic content");
  });

  it("keeps worktree port guidance responsible for final Memory handoff context", async () => {
    const source = await readFile(WORKTREE_RULES_SKILL_PATH, "utf-8");

    // /port-changes owns sync evidence, but final Memory owns durable closure.
    expect(source).toContain("--debrief-file /tmp/final-debrief.md");
    expect(source).toContain("--debrief-tldr-file /tmp/final-debrief-tldr.md");
    expect(source).toContain("Port is not final quest closure");
    expect(source).toContain("final Memory owns structured final debrief metadata");
    expect(source).toContain("Final debrief draft:");
    expect(source).toContain("Debrief TLDR draft:");
    expect(source).toContain("accepted-state summary");
    expect(source).toContain("self-contained quest-journey understanding");
    expect(source).toContain("Keep routine commit hashes, branch names, command lists");
  });
});
