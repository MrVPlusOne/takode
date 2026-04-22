import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
  chmodSync: vi.fn(),
}));

const execSyncMock = vi.hoisted(() => vi.fn(() => "/repo/.git\n"));

vi.mock("node:os", () => ({
  homedir: () => "/home/tester",
}));

vi.mock("node:fs", () => fsMocks);

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

import { ensureQuestmasterIntegration } from "./quest-integration.js";

describe("ensureQuestmasterIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    execSyncMock.mockReturnValue("/repo/.git\n");
  });

  it("writes quest skill to both Claude and Codex skill homes", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.claude/skills/quest", { recursive: true });
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.codex/skills/quest", { recursive: true });
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.claude/skills/quest/SKILL.md",
      expect.stringContaining("name: quest"),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.codex/skills/quest/SKILL.md",
      expect.stringContaining("name: quest"),
      "utf-8",
    );
  });

  it("includes explicit feedback-addressing workflow in generated skill", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("quest address <id> <index> [--json]");
    // Validates the pre-submission checklist includes feedback-addressing and summary requirements
    expect(skill).toContain("Address all human feedback");
    expect(skill).toContain("Both steps are required");
    expect(skill).toContain("Add a summary comment");
    expect(skill).toContain("required worker deliverable");
  });

  it("requires titles under 10 words for refined and later stages", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("Title rule for refined and later");
    expect(skill).toContain("less than 10 words");
    expect(skill).toContain("refined`, `in_progress`, `needs_verification`, or `done");
  });

  it("tells worktree workers to sync to main before needs_verification", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("Worktree sessions:");
    expect(skill).toContain("do **not** run `quest complete`");
    expect(skill).toContain("synced to the main repo checkout and pushed");
    expect(skill).toContain('quest complete q-N --items "..." --commits "sha1,sha2"');
    expect(skill).toContain("Synced SHAs: sha1,sha2");
    expect(skill).toContain("Do not rely on log parsing or memory");
    expect(skill).toContain("Do not leave commit info only in comments");
    expect(skill).toContain("one substantive quest-level prose summary");
    expect(skill).toContain("Re-running the same summary-style feedback (`Summary:` or `Refreshed summary:`)");
    expect(skill).toContain("Only add a second port-specific comment");
    expect(skill).toContain("pass `quest complete ... --no-code`");
    expect(skill).toContain("only a local reminder switch");
    expect(skill).toContain("no placeholder port notes or synced SHA lines");
  });

  it("instructs agents to use quest directly before PATH fallbacks", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("Prefer `quest ...` directly when `quest` is already on PATH");
    expect(skill).toContain("Do not prepend to `PATH` proactively");
  });

  it("writes a checkout-agnostic shared quest dispatcher", async () => {
    await ensureQuestmasterIntegration(3456, "/worktrees/wt-1/web", "server-a");

    const sharedWrite = fsMocks.writeFileSync.mock.calls.find((call) => call[0] === "/home/tester/.companion/bin/quest");
    expect(sharedWrite).toBeDefined();

    const sharedWrapper = String(sharedWrite?.[1] ?? "");
    expect(sharedWrapper).toContain('server_root="$HOME/.companion/bin/servers"');
    expect(sharedWrapper).toContain('server_wrapper="$server_root/$COMPANION_SERVER_ID/quest"');
    expect(sharedWrapper).toContain('echo "quest: multiple server-local wrappers found; set COMPANION_SERVER_ID or run from a launched session" >&2');
    expect(sharedWrapper).not.toContain('exec "$HOME/.bun/bin/bun" "/repo/web/bin/quest.ts" "$@"');
    expect(sharedWrapper).not.toContain('if [ -x "$HOME/.bun/bin/bun" ]');
    expect(sharedWrapper).not.toContain("/worktrees/wt-1/web/bin/quest.ts");
    expect(sharedWrapper).not.toContain("/repo/web/bin/quest.ts");

    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-a/quest",
      expect.stringContaining('exec bun "/worktrees/wt-1/web/bin/quest.ts" "$@"'),
      "utf-8",
    );
  });

  it("writes a ~/.local/bin/quest shim that delegates to ~/.companion/bin/quest", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/home/tester/.local/bin", { recursive: true });
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.local/bin/quest",
      expect.stringContaining('exec "$HOME/.companion/bin/quest" "$@"'),
      "utf-8",
    );
    expect(fsMocks.chmodSync).toHaveBeenCalledWith("/home/tester/.local/bin/quest", 0o755);
  });

  it("writes a ~/.local/bin/rg compatibility shim", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

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
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("quest later  <id> [--json]");
    expect(skill).toContain("quest inbox  <id> [--json]");
    expect(skill).toContain("--verification <scope>");
    expect(skill).toContain("Verification Inbox workflow");
    expect(skill).toContain("quest list --verification inbox");
  });

  it("tells agents to prefer plain-text quest show and reserve --json for exact fields", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("Prefer the plain-text form");
    expect(skill).toContain("feedback `addressed` flags");
    expect(skill).toContain("`commitShas`");
    expect(skill).toContain("version-local metadata from `quest history`");
  });

  it("documents quest grep as the preferred way to search inside quest text and comments", async () => {
    await ensureQuestmasterIntegration(3456, "/repo/web", "server-a");

    const codexSkillWrite = fsMocks.writeFileSync.mock.calls.find(
      (call) => call[0] === "/home/tester/.codex/skills/quest/SKILL.md",
    );
    expect(codexSkillWrite).toBeDefined();

    const skill = String(codexSkillWrite?.[1] ?? "");
    expect(skill).toContain("quest grep   <pattern> [--count N] [--json]");
    expect(skill).toContain("Search quest title, description, and feedback/comments");
    expect(skill).toContain("Use `quest grep` when you need to search **inside** quest titles");
    expect(skill).toContain("Use `quest list --text` when you are broadly filtering the quest list");
    expect(skill).toContain("prefer `quest grep <pattern>` over manually scanning `quest show` output");
  });

  it("keeps shared quest wrapper semantics identical across different checkout roots while isolating server-local wrappers", async () => {
    await ensureQuestmasterIntegration(3456, "/checkout-a/web", "server-a");
    await ensureQuestmasterIntegration(3456, "/checkout-b/web", "server-b");

    const sharedWrites = fsMocks.writeFileSync.mock.calls.filter((call) => call[0] === "/home/tester/.companion/bin/quest");
    expect(sharedWrites).toHaveLength(2);
    expect(sharedWrites[0]?.[1]).toBe(sharedWrites[1]?.[1]);

    const sharedWrapper = String(sharedWrites[1]?.[1] ?? "");
    expect(sharedWrapper).not.toContain("/repo/web/bin/quest.ts");
    expect(sharedWrapper).not.toContain("/checkout-a/web/bin/quest.ts");
    expect(sharedWrapper).not.toContain("/checkout-b/web/bin/quest.ts");

    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-a/quest",
      expect.stringContaining('exec bun "/checkout-a/web/bin/quest.ts" "$@"'),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-b/quest",
      expect.stringContaining('exec bun "/checkout-b/web/bin/quest.ts" "$@"'),
      "utf-8",
    );
  });
});
