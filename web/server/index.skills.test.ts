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
const TAKODE_ORCHESTRATION_SKILL_PATH = join(
  SERVER_DIR,
  "..",
  "..",
  ".claude",
  "skills",
  "takode-orchestration",
  "SKILL.md",
);
const LEADER_DISPATCH_EDGE_CASES_PATH = join(
  SERVER_DIR,
  "..",
  "..",
  ".claude",
  "skills",
  "leader-dispatch",
  "references",
  "edge-cases.md",
);
const LEADER_DISPATCH_PHASE_HANDOFF_EXAMPLES_PATH = join(
  SERVER_DIR,
  "..",
  "..",
  ".claude",
  "skills",
  "leader-dispatch",
  "references",
  "phase-handoff-examples.md",
);
const TAKODE_ORCHESTRATION_QUEST_JOURNEY_PATH = join(
  SERVER_DIR,
  "..",
  "..",
  ".claude",
  "skills",
  "takode-orchestration",
  "quest-journey.md",
);
const QUEST_SKILL_TEMPLATE_PATH = join(SERVER_DIR, "templates", "quest-skill-docs.md");
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
    // If a nonexistent project skill is reintroduced here, startup will recreate
    // warning spam and potentially broken symlink state. Guard the actual
    // ensureSkillSymlinks(...) registration list in index.ts directly.
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

  it("keeps the loaded Quest Journey guidance aligned with the v2 active catalog", async () => {
    const [source, topLevelSource] = await Promise.all([
      readFile(TAKODE_ORCHESTRATION_QUEST_JOURNEY_PATH, "utf-8"),
      readFile(TAKODE_ORCHESTRATION_SKILL_PATH, "utf-8"),
    ]);

    expect(source).toContain("`alignment -> work -> memory`");
    expect(source).toContain("| Work | `WORKING` |");
    expect(source).toContain("| User Checkpoint | `USER_CHECKPOINTING` |");
    expect(source).toContain("| Memory | `MEMORY` |");
    expect(source).toContain("Legacy v1 phase IDs are rejected for new active rows and revisions");
    expect(source).not.toContain("`EXECUTING`");
    expect(source).not.toContain("`OUTCOME_REVIEWING`");
    expect(topLevelSource).toContain("Externally consequential User Checkpoints require fresh explicit approval");
    expect(topLevelSource).toContain("A material edit alone is not approval");
    expect(topLevelSource).toContain("One fresh reply may make one exact substitution");
    expect(topLevelSource).toContain("Otherwise fail closed, republish the exact packet");
    expect(topLevelSource).toContain("fresh explicit approval before external consequences");
    expect(topLevelSource).toContain("Harmless typo-only corrections can still proceed");
  });

  it("keeps leader dispatch hot path compact while preserving handoff references", async () => {
    const [source, edgeCases, phaseExamples, worktreeRules] = await Promise.all([
      readFile(LEADER_DISPATCH_SKILL_PATH, "utf-8"),
      readFile(LEADER_DISPATCH_EDGE_CASES_PATH, "utf-8"),
      readFile(LEADER_DISPATCH_PHASE_HANDOFF_EXAMPLES_PATH, "utf-8"),
      readFile(WORKTREE_RULES_SKILL_PATH, "utf-8"),
    ]);

    expect(source).toContain("This section is the visible reference catalog");
    expect(source).toContain("ordinary Markdown reference headings are not loaded until you read the file");
    expect(source).toContain("references/edge-cases.md");
    expect(source).toContain("memory-specific handoff/completion deltas");
    expect(source).toContain("references/phase-handoff-examples.md");
    expect(source).toContain("Dispatch Approval Rubric");
    expect(source).toContain("Direct create/dispatch is allowed only when");
    expect(source).toContain("Pre-dispatch approval is mandatory when");
    expect(source).toContain("Use delayed approval via User Checkpoint");
    expect(source).toContain("Externally consequential User Checkpoints need fresh explicit approval");
    expect(source).toContain("A material edit alone is not approval");
    expect(source).toContain('"Change the batch limit to 120" is edit-only');
    expect(source).toContain('"Approve the bounded operation with batch limit 120" may approve');
    expect(source).toContain("ambiguous referents; dependent changes");
    expect(source).toContain("changed monitor/stop conditions, safety implications, consequences, or tradeoffs");
    expect(source).toContain("all require republishing and reapproval");
    expect(source).toContain("Harmless typo-only corrections can be recorded");
    expect(source).toContain("Send this only after authorization and board recording:");
    expect(source).not.toContain("Send this only after approval and board recording:");
    expect(source).toContain("Read this phase brief first:");
    expect(source).toContain("Provide only deltas the assignee cannot infer");
    expect(source).not.toContain("Memory command mechanics live in the relevant phase briefs");

    expect(edgeCases).toContain("## Memory-Specific Dispatch Deltas");
    expect(edgeCases).toContain("Final Memory owns durable-state closure");
    expect(edgeCases).toContain("Do not require routine `memory update not needed` statements");
    expect(edgeCases).not.toContain("Read this reference only when");

    expect(phaseExamples).toContain("## Work");
    expect(phaseExamples).toContain("## Memory");
    expect(phaseExamples).toContain("## Separate Review Quest");
    expect(phaseExamples).toContain("Leader-specific deltas: <accepted refs");
    expect(phaseExamples).not.toContain("Read this reference only when");

    expect(worktreeRules).toContain("Do not silently narrow the gate to focused tests");
    expect(worktreeRules).toContain("route the worker back to fix it before the quest can be marked done");
    expect(worktreeRules).toContain("open an immediate fix quest");
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
    expect(source).toContain("Run the required pre-push gate");
    expect(source).toContain("For tracked code/test changes, verify the main repo before pushing");
    expect(source).toContain("focused affected tests for the accepted change");
    expect(source).toContain("cd <BASE_REPO>/web && bun --no-install run test");
    expect(source).toContain("Do not silently narrow the gate to focused tests");
    expect(source).toContain("do not push");
    expect(source).toContain("open an immediate fix quest");
    expect(source).toContain("--debrief-file /tmp/final-debrief.md");
    expect(source).toContain("--debrief-tldr-file /tmp/final-debrief-tldr.md");
    expect(source).toContain("Sync/push is not final quest closure");
    expect(source).toContain("final Memory owns final User review check settlement");
    expect(source).toContain("structured final debrief metadata");
    expect(source).toContain("Final debrief draft:");
    expect(source).toContain("Debrief TLDR draft:");
    expect(source).toContain("accepted-state summary");
    expect(source).toContain("Do not add routine `memory update not needed` statements during Work-owned sync");
    expect(source).toContain("self-contained quest-journey understanding");
    expect(source).toContain("Keep routine commit hashes, branch names, command lists");
  });

  it("documents the full gate for tracked code/test changes in quest-facing guidance", async () => {
    const docs = await Promise.all([
      readFile(join(REPO_ROOT, "CLAUDE.md"), "utf-8"),
      readFile(join(REPO_ROOT, "AGENTS.md"), "utf-8"),
      readFile(QUEST_SKILL_TEMPLATE_PATH, "utf-8"),
    ]);

    for (const doc of docs) {
      expect(doc).toContain("For tracked code/test changes");
      expect(doc).toContain("cd web && bun --no-install run typecheck");
      expect(doc).toContain("cd web && bun --no-install run test");
      expect(doc).toContain("cd web && bun --no-install run format:check");
      expect(doc).not.toContain("For refactor quests");
    }
  });
});
