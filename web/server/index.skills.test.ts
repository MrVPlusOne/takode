import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(SERVER_DIR, "index.ts");
const SKEPTIC_REVIEW_SKILL_PATH = join(SERVER_DIR, "..", "..", ".claude", "skills", "skeptic-review", "SKILL.md");
const WORKTREE_RULES_SKILL_PATH = join(SERVER_DIR, "..", "..", ".claude", "skills", "worktree-rules", "SKILL.md");
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

  it("keeps skeptic-review summary creation guidance from teaching lossy long summaries", async () => {
    const source = await readFile(SKEPTIC_REVIEW_SKILL_PATH, "utf-8");

    expect(source).toContain('quest feedback add <quest_id> --text "Summary: ..."');
    expect(source).toContain("--text-file /tmp/summary.md");
    expect(source).toContain("--tldr-file /tmp/summary-tldr.md");
    expect(source).toContain("for long multi-topic content");
  });

  it("keeps worktree port guidance responsible for final debrief metadata", async () => {
    const source = await readFile(WORKTREE_RULES_SKILL_PATH, "utf-8");

    // /port-changes is the worktree completion path. It should not depend on a
    // leader remembering generic bookkeeping to create the final debrief.
    expect(source).toContain("--debrief-file /tmp/final-debrief.md");
    expect(source).toContain("--debrief-tldr-file /tmp/final-debrief-tldr.md");
    expect(source).toContain("Every completed non-cancelled quest needs both final debrief metadata");
    expect(source).toContain("Final debrief draft:");
    expect(source).toContain("Debrief TLDR draft:");
    expect(source).toContain("focused Bookkeeping phase for final debrief metadata");
    expect(source).toContain("self-contained quest-journey understanding");
    expect(source).toContain("Keep routine commit hashes, branch names, command lists");
  });
});
