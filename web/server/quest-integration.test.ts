import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  lstatSync: vi.fn((_targetDir: string): any => {
    throw missingPathError();
  }),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  chmodSync: vi.fn(),
}));

function missingPathError(): Error & { code: string } {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

const execMock = vi.hoisted(() =>
  vi.fn((command: string, options: { cwd?: string }, callback: (error: Error | null, stdout: string) => void) => {
    if (command.includes("rev-parse --git-common-dir")) {
      if (options.cwd?.startsWith("/repo")) {
        callback(null, "/repo/.git\n");
        return;
      }
      callback(null, "/main-checkout/.git\n");
      return;
    }
    callback(new Error(`Unexpected command: ${command}`), "");
  }),
);

vi.mock("node:os", () => ({
  homedir: () => "/home/tester",
}));

vi.mock("node:fs", () => fsMocks);
vi.mock("node:child_process", () => ({
  exec: execMock,
}));

import { ensureQuestmasterIntegration } from "./quest-integration.js";

function writtenFile(path: string): string {
  const write = fsMocks.writeFileSync.mock.calls.find((call) => call[0] === path);
  expect(write).toBeDefined();
  return String(write?.[1] ?? "");
}

describe("ensureQuestmasterIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.lstatSync.mockImplementation((_targetDir: string) => {
      throw missingPathError();
    });
  });

  it("writes quest skill to Claude and agents skill homes", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.claude/skills/quest", { recursive: true });
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.agents/skills/quest", { recursive: true });
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.claude/skills/quest/SKILL.md",
      expect.stringContaining("name: quest"),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.agents/skills/quest/SKILL.md",
      expect.stringContaining("name: quest"),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.claude/skills/quest/memory-completion.md",
      expect.stringContaining("Quest Memory and Completion Details"),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.agents/skills/quest/memory-completion.md",
      expect.stringContaining("Quest Memory and Completion Details"),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).not.toHaveBeenCalledWith(
      "/home/tester/.codex/skills/quest/SKILL.md",
      expect.anything(),
      "utf-8",
    );
  });

  it("replaces stale agents quest symlinks before writing the generated quest skill", async () => {
    // Covers the legacy migration state where ~/.agents/skills/quest pointed at
    // ~/.codex/skills/quest. The generated quest skill must become a real,
    // current agents skill before legacy Codex cleanup can remove that target.
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.agents/skills/quest") {
        return { isSymbolicLink: () => true, isDirectory: () => false };
      }
      throw missingPathError();
    });

    await ensureQuestmasterIntegration(3456, "/repo/web");

    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.agents/skills/quest");
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.agents/skills/quest", { recursive: true });
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.agents/skills/quest/SKILL.md",
      expect.stringContaining("name: quest"),
      "utf-8",
    );
    const unlinkCallIndex = fsMocks.unlinkSync.mock.calls.findIndex(
      (call) => call[0] === "/home/tester/.agents/skills/quest",
    );
    const writeCallIndex = fsMocks.writeFileSync.mock.calls.findIndex(
      (call) => call[0] === "/home/tester/.agents/skills/quest/SKILL.md",
    );
    expect(fsMocks.unlinkSync.mock.invocationCallOrder[unlinkCallIndex]).toBeLessThan(
      fsMocks.writeFileSync.mock.invocationCallOrder[writeCallIndex]!,
    );
  });

  it("overwrites generated quest subfiles when stale or missing", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const mainSkill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    const memoryCompletion = writtenFile("/home/tester/.agents/skills/quest/memory-completion.md");

    expect(mainSkill).toContain("Read `memory-completion.md`");
    expect(memoryCompletion).toContain("Stream Memory CLI");
    expect(memoryCompletion).toContain("User review checks are optional human-owned checks only");
    expect(memoryCompletion).toContain("--memory-commit <sha>");
  });

  it("includes explicit feedback-addressing workflow in generated skill", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const skill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    const memoryCompletion = writtenFile("/home/tester/.agents/skills/quest/memory-completion.md");
    expect(skill).toContain("quest address <id> <index> [--json]");
    expect(memoryCompletion).toContain("Address all human feedback");
    expect(memoryCompletion).toContain("Both steps are required");
    expect(memoryCompletion).toContain("Add or refresh a user-oriented summary comment");
    expect(memoryCompletion).toContain("what changed, why it matters, and what verification passed");
    expect(memoryCompletion).toContain("Write the summary as an outcome note, not a review or rework timeline");
    expect(skill).toContain("TLDR Quality Guidance");
    expect(skill).toContain("Write the full description, feedback, or summary body first");
    expect(skill).toContain("quest feedback add q-N --text-file summary.md --tldr-file summary-tldr.md");
    expect(skill).toContain("Final debrief TLDRs should be self-contained quest-journey summaries");
    expect(skill).toContain("Phase-note TLDRs should usually be 1-5 scan-friendly bullets or sentences");
    expect(skill).toContain("Machine-oriented bookkeeping, including synced SHA lists");
    expect(skill).toContain("Once commits or hashes are attached as structured metadata");
    expect(skill).toContain("do not repeat the raw identifiers in TLDRs");
    expect(skill).toContain("File Link Guidance");
    expect(skill).toContain("[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)");
    expect(skill).toContain("Standard Markdown file links to repo files may be opened best-effort");
    expect(skill).toContain("Quest Journey Phase Documentation");
    expect(skill).toContain("every active phase should leave durable quest feedback");
    expect(skill).toContain("For memory record frontmatter `source`");
    expect(skill).toContain("Do not routinely add `commit:*` or `session:*` sources");
    expect(skill).toContain("Maintain one current phase note per phase occurrence");
    expect(skill).toContain("quest feedback edit <id> <index>");
    expect(skill).toContain("instead of appending a near-duplicate note");
    expect(skill).toContain("explicitly say which prior feedback index is superseded");
    expect(skill).toContain("For phase-note TLDRs, write 1-5 scan-friendly bullets or sentences");
    expect(skill).toContain("takode worker-stream");
    expect(skill).toContain("optional, creates an internal herd checkpoint");
    expect(skill).toContain("does not replace phase documentation, final debrief metadata");
    expect(skill).toContain("quest feedback add q-N --text-file /tmp/phase.md --tldr-file /tmp/phase-tldr.md");
    expect(skill).toContain("If inference is unavailable or ambiguous");
    expect(skill).toContain("Reviewers should check documentation quality, not just whether a comment exists");
    expect(skill).toContain("One TLDR bullet or sentence is fine only when the source truly has one main point");
    expect(memoryCompletion).toContain("For long multi-topic summaries, write the full `Summary:` body first");
    expect(memoryCompletion).toContain("Reviewer-owned quest hygiene");
    expect(memoryCompletion).toContain('`quest feedback add q-N --text "Summary: ..."` for short single-topic content');
    expect(memoryCompletion).toContain(
      "quest feedback q-N --text-file /tmp/summary.md --tldr-file /tmp/summary-tldr.md",
    );
    expect(skill).toContain(
      [
        "### quest transition <id> --status <s> [flags]",
        "| Flag | Description |",
        "|------|-------------|",
        "| `--status <s>` | Target status (REQUIRED) |",
        '| `--desc "..."` | Optional description update |',
        "| `--desc-file <path>` | Read the description update from a file, or use `-` to read from stdin |",
        '| `--tldr "..."` | Optional human-readable TLDR metadata for long descriptions |',
        "| `--tldr-file <path>` | Read TLDR metadata from a file, or use `-` to read from stdin |",
      ].join("\n"),
    );
    expect(memoryCompletion).toContain("Prefer one consolidated feedback entry");
    expect(memoryCompletion).toContain("This summary may also explain addressed human feedback");
    expect(memoryCompletion).toContain("Avoid review-process timelines, duplicate near-identical comments");
    expect(memoryCompletion).toContain("required worker deliverable");
    expect(skill).toContain("send the changed worktree back to Code Review only after that checkpoint exists");
    expect(skill).toContain("clean incremental diff of only the new work");
    expect(skill).toContain("does not apply to purely read-only follow-up review discussion");
  });

  it("requires quest-design before quest creation or refinement only", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const skill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    expect(skill).toContain("Required `/quest-design` before quest creation or refinement");
    expect(skill).toContain("invoke `/quest-design` and complete its confirmation round");
    expect(skill).toContain("Before any agent creates a new quest or refines an `idea` quest");
    expect(skill).toContain("Stop and wait for confirmation or correction");
    expect(skill).toContain("Use `/quest-design` before:");
    expect(skill).toContain("`quest create`");
    expect(skill).toContain("`quest edit` or `quest transition --status refined` when refining an `idea` quest");
    expect(skill).toContain("full approval workflow lives in the existing `quest-design` skill");
    expect(skill).toContain("combined quest/Journey approval rules");
    expect(skill).toContain("follow-up relationship guidance");
    expect(skill).toContain("Operations that do not require `/quest-design`");
    expect(skill).toContain("Adding human or agent feedback to an existing quest");
    expect(skill).toContain("Routine progress bookkeeping after approved work");
    expect(skill).toContain("invoke `/quest-design` before applying them");
    expect(skill).toContain("Ask clarifying questions until the goal, scope, and non-goals are clear enough");
    expect(skill).toContain("Draft the refined title, description, and tags, then invoke `/quest-design`");
    expect(skill).toContain("include `Relationship: follow-up of [q-M](quest:q-M)`");
    expect(skill).toContain("Wait for user confirmation or correction");
    expect(skill).toContain('[--tags "t1,t2"] [--session-space <slug>] [--follow-up-of "q-1,q-2"]');
    expect(skill).toContain('[--follow-up-of "q-1,q-2" | --clear-follow-up-of]');
    expect(skill).toContain("| `--status idea|refined` | Initial quest status; defaults to `idea` |");
    expect(skill).toContain('| `--follow-up-of "q-1,q-2"` | Persist that the new quest is a true follow-up');
    expect(skill).toContain("| `--clear-follow-up-of` | Clear explicit follow-up relationships");
    expect(skill).not.toContain("Proposed Quest");
    expect(skill).not.toContain("Make it read like a TLDR for approval");
    expect(skill).not.toContain("full quest-body paste");
    expect(skill).not.toContain("Before any agent creates a quest or materially updates/refines an existing quest");
    expect(skill).not.toContain("When in doubt, treat the change as material and confirm first");
  });

  it("requires titles under 10 words for refined and later stages", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const skill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    expect(skill).toContain("Title rule for refined and later");
    expect(skill).toContain("less than 10 words");
    expect(skill).toContain("`refined`, `in_progress`, or `done`");
  });

  it("tells worktree workers to sync to main before done", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const skill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    const memoryCompletion = writtenFile("/home/tester/.agents/skills/quest/memory-completion.md");
    expect(skill).toContain("Worktree sessions must not run `quest complete`");
    expect(skill).toContain("synced to the main repo checkout and pushed");
    expect(memoryCompletion).toContain(
      'quest complete q-N --commits "sha1,sha2" --debrief-file /tmp/final-debrief.md --debrief-tldr-file /tmp/final-debrief-tldr.md',
    );
    expect(skill).toContain("[--memory-commit <sha>] [--memory-commits");
    expect(memoryCompletion).toContain("file-based memory repo commits");
    expect(memoryCompletion).toContain("Keep code commit metadata separate from memory commit metadata");
    expect(memoryCompletion).toContain("Synced SHAs: sha1,sha2");
    expect(memoryCompletion).toContain("Final Memory or the leader attaches those SHAs");
    expect(memoryCompletion).toContain("Final debrief draft:");
    expect(memoryCompletion).toContain("Debrief TLDR draft:");
    expect(skill).toContain("route final Memory");
    expect(memoryCompletion).toContain("Do not rely on log parsing or memory");
    expect(skill).toContain("Every completed non-cancelled quest must include a final debrief and debrief TLDR");
    expect(memoryCompletion).toContain("Completion without both a final debrief and a debrief TLDR is incomplete");
    expect(memoryCompletion).toContain("Metadata reconciliation is a final-scope accuracy check");
    expect(memoryCompletion).toContain("not permission to rewrite active scope or unfinished quests");
    expect(memoryCompletion).toContain("If Port is omitted");
    expect(memoryCompletion).toContain("Do not leave commit info only in comments");
    expect(memoryCompletion).toContain("one substantive quest-level prose summary");
    expect(memoryCompletion).toContain("what changed, why it matters, and what verification passed");
    expect(skill).toContain("Use value-based compression instead of hard length caps");
    expect(skill).toContain("file-by-file diff narration");
    expect(skill).toContain("Keep the memory boundary explicit");
    expect(skill).toContain("If your context was compacted during the phase");
    expect(memoryCompletion).toContain("structured final debrief metadata");
    expect(skill).toContain("--debrief-file");
    expect(skill).toContain("--debrief-tldr-file");
    expect(memoryCompletion).toContain("If you complete a quest");
    expect(memoryCompletion).toContain("The debrief TLDR should stay higher level and self-contained");
    expect(memoryCompletion).toContain("Routine synced SHAs, raw commit IDs, branch names");
    expect(memoryCompletion).toContain(
      "command lists or transcripts, raw paths, and verification mechanics belong in the body",
    );
    expect(memoryCompletion).toContain("If commit metadata or a `Synced SHAs:` handoff already carries exact values");
    expect(memoryCompletion).toContain(
      "Challenge TLDRs or routine user-facing summaries that repeat raw commits/hashes",
    );
    expect(memoryCompletion).toContain(
      "Re-running the same summary-style feedback (`Summary:` or `Refreshed summary:`)",
    );
    expect(memoryCompletion).toContain("Only add a second port-specific comment");
    expect(memoryCompletion).toContain("pass `quest complete ... --no-code`");
    expect(memoryCompletion).toContain("only a local reminder switch");
    expect(memoryCompletion).toContain(
      "Do not add placeholder Port notes, synced SHA lines, or automated-check results as checks",
    );
    expect(memoryCompletion).toContain("zero git-tracked changes");
    expect(skill).toContain(
      "Docs, skills, prompts, templates, and other text-only tracked-file edits are commit-producing work",
    );
    expect(skill).toContain("Do not use `--no-code` for these quests");
    expect(skill).toContain("User review checks are optional human-owned checks only");
    expect(memoryCompletion).toContain(
      "Put what changed, why it matters, synced/ported status, and automated verification results",
    );
  });

  it("instructs agents to use quest directly before PATH fallbacks", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const skill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    expect(skill).toContain("Prefer `quest ...` directly when `quest` is already on PATH");
    expect(skill).toContain("Do not prepend to `PATH` proactively");
  });

  it("writes a copied global quest wrapper targeting the stable main checkout", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/worktrees/wt-1/web");

    const sharedWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.companion/bin/quest",
    );
    expect(sharedWrite).toBeDefined();

    const sharedWrapper = String(sharedWrite?.[1] ?? "");
    expect(sharedWrapper).toContain('exec bun "/repo/web/bin/quest.ts" "$@"');
    expect(sharedWrapper).toContain('exec "$HOME/.bun/bin/bun" "/repo/web/bin/quest.ts" "$@"');
    expect(sharedWrapper).not.toContain("/repo/worktrees/wt-1/web/bin/quest.ts");
    expect(fsMocks.writeFileSync).not.toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-a/quest",
      expect.anything(),
      "utf-8",
    );

    const memoryWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.companion/bin/memory",
    );
    expect(memoryWrite).toBeDefined();
    const memoryWrapper = String(memoryWrite?.[1] ?? "");
    expect(memoryWrapper).toContain('exec bun "/repo/web/bin/memory.ts" "$@"');
    expect(memoryWrapper).not.toContain("/repo/worktrees/wt-1/web/bin/memory.ts");

    const streamWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.companion/bin/stream",
    );
    expect(streamWrite).toBeDefined();
    const streamWrapper = String(streamWrite?.[1] ?? "");
    expect(streamWrapper).toContain('exec bun "/repo/web/bin/stream.ts" "$@"');
    expect(streamWrapper).not.toContain("/repo/worktrees/wt-1/web/bin/stream.ts");
  });

  it("writes ~/.local/bin quest, memory, and stream shims that delegate to ~/.companion/bin", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.local/bin", { recursive: true });
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/quest",
      expect.stringContaining('exec "$HOME/.companion/bin/quest" "$@"'),
      "utf-8",
    );
    expect(fsMocks.chmodSync).toHaveBeenCalledWith("/home/tester/.local/bin/quest", 0o755);
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/memory",
      expect.stringContaining('exec "$HOME/.companion/bin/memory" "$@"'),
      "utf-8",
    );
    expect(fsMocks.chmodSync).toHaveBeenCalledWith("/home/tester/.local/bin/memory", 0o755);
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/stream",
      expect.stringContaining('exec "$HOME/.companion/bin/stream" "$@"'),
      "utf-8",
    );
    expect(fsMocks.chmodSync).toHaveBeenCalledWith("/home/tester/.local/bin/stream", 0o755);
  });

  it("writes a ~/.local/bin/rg compatibility shim", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/rg",
      expect.stringContaining("rg (companion shim) 0.0.0"),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/rg",
      expect.stringContaining('if [ "$1" = "--files" ]; then'),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/rg",
      expect.stringContaining("grep_args=("),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/rg",
      expect.stringContaining('exec grep "${grep_args[@]}" -- "$pattern" "${positional[@]:1}"'),
      "utf-8",
    );
    expect(fsMocks.chmodSync).toHaveBeenCalledWith("/home/tester/.local/bin/rg", 0o755);
  });

  it("documents verification inbox commands and filters", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const skill = writtenFile("/home/tester/.agents/skills/quest/SKILL.md");
    const memoryCompletion = writtenFile("/home/tester/.agents/skills/quest/memory-completion.md");
    expect(skill).toContain("quest later  <id> [--json]");
    expect(skill).toContain("quest inbox  <id> [--json]");
    expect(skill).toContain("--verification <scope>");
    expect(memoryCompletion).toContain("Review inbox workflow");
    expect(memoryCompletion).toContain("quest list --verification inbox");
  });

  it("tells agents to prefer plain-text quest show and reserve --json for exact fields", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.agents/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("Prefer the plain-text form");
    expect(skill).toContain("quest feedback list/latest/show");
    expect(skill).toContain("quest feedback list --json");
    expect(skill).toContain("`commitShas`");
    expect(skill).toContain("legacy backup metadata from `quest history`");
  });

  it("documents feedback inspection and compact status commands", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.agents/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("quest status <id>");
    expect(skill).toContain("quest feedback list <id>");
    expect(skill).toContain("quest feedback latest <id>");
    expect(skill).toContain("quest feedback show <id> <index>");
    expect(skill).toContain("quest feedback edit <id> <index>");
    expect(skill).toContain("Use these read-only commands instead of `quest show --json` plus jq/Python");
  });

  it("documents quest grep as the preferred way to search inside quest text and comments", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.agents/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("quest grep   <pattern> [--count N] [--json]");
    expect(skill).toContain("Search quest title, description, final debrief, and feedback/comments");
    expect(skill).toContain("Use `quest grep` when you need to search **inside** quest titles");
    expect(skill).toContain("Use `quest list --text` when you are broadly filtering the quest list");
    expect(skill).toContain("prefer `quest grep <pattern>` over manually scanning `quest show` output");
  });

  it("keeps copied quest wrappers identical across worktrees of the same repo", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/worktrees/wt-a/web");
    await ensureQuestmasterIntegration(3456, "/repo/worktrees/wt-b/web");

    const sharedWrites = fsMocks.writeFileSync.mock.calls.filter(
      (call) => call[0] === "/home/tester/.companion/bin/quest",
    );
    expect(sharedWrites).toHaveLength(2);
    expect(sharedWrites[0]?.[1]).toBe(sharedWrites[1]?.[1]);

    const sharedWrapper = String(sharedWrites[1]?.[1] ?? "");
    expect(sharedWrapper).toContain("/repo/web/bin/quest.ts");
    expect(sharedWrapper).not.toContain("/repo/worktrees/wt-a/web/bin/quest.ts");
    expect(sharedWrapper).not.toContain("/repo/worktrees/wt-b/web/bin/quest.ts");
  });
});
