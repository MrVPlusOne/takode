import { describe, expect, it } from "vitest";
import { buildCompanionInstructions, getOrchestratorGuardrails } from "./cli-launcher-instructions.js";

describe("buildCompanionInstructions", () => {
  it("includes the leader-reply rule for Claude sessions", () => {
    const result = buildCompanionInstructions({ sessionNum: 1, backend: "claude" });
    // Claude workers must see this rule so they don't try tool-based replies
    expect(result).toContain("## Responding to Leaders");
    expect(result).toContain("Do NOT use `SendMessage`");
    expect(result).toContain("SendMessageToLeader");
    expect(result).toContain("herd events");
  });

  it("includes the leader-reply rule when backend is unspecified (defaults to Claude-like)", () => {
    const result = buildCompanionInstructions({ sessionNum: 1 });
    expect(result).toContain("## Responding to Leaders");
  });

  it("excludes the leader-reply rule for Codex sessions", () => {
    // Codex doesn't have SendMessage tools, so the rule is unnecessary
    const result = buildCompanionInstructions({ sessionNum: 1, backend: "codex" });
    expect(result).not.toContain("## Responding to Leaders");
    expect(result).not.toContain("SendMessageToLeader");
  });

  it("includes session identity when sessionNum is provided", () => {
    const result = buildCompanionInstructions({ sessionNum: 42 });
    expect(result).toContain("Takode session #42");
  });

  it("includes worktree guardrails when worktree is provided", () => {
    const result = buildCompanionInstructions({
      worktree: { branch: "test-branch", repoRoot: "/repo" },
    });
    expect(result).toContain("Worktree Session");
    expect(result).toContain("test-branch");
  });

  it("appends extraInstructions at the end", () => {
    const result = buildCompanionInstructions({
      backend: "claude",
      extraInstructions: "EXTRA_MARKER",
    });
    expect(result).toContain("EXTRA_MARKER");
    // Extra instructions should come after the base sections
    const leaderIdx = result.indexOf("## Responding to Leaders");
    const extraIdx = result.indexOf("EXTRA_MARKER");
    expect(extraIdx).toBeGreaterThan(leaderIdx);
  });
});

describe("getOrchestratorGuardrails", () => {
  it("returns claude-flavored guardrails by default", () => {
    const result = getOrchestratorGuardrails();
    expect(result).toContain("orchestrator agent");
    expect(result).toContain("commit the current worktree state first");
    expect(result).toContain("separate follow-up commit");
  });

  it("returns codex-flavored guardrails for codex backend", () => {
    const result = getOrchestratorGuardrails("codex");
    expect(result).toContain("orchestrator leader session");
    expect(result).toContain("checkpoint the current state in a commit before the fixes");
  });
});
