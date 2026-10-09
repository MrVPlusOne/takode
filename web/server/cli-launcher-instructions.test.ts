import { describe, expect, it } from "vitest";
import {
  buildCompanionInstructions,
  buildInjectedSystemPromptForDebug,
  getOrchestratorGuardrails,
} from "./cli-launcher-instructions.js";
import { TAKODE_LINK_SYNTAX_INSTRUCTIONS } from "./link-syntax.js";
import { normalizePersistedBackendType, type BackendType } from "./session-types.js";
import { AUXILIARY_WORKTREE_INSTRUCTIONS } from "./auxiliary-worktree-instructions.js";
import { QUEST_JOURNEY_PHASES } from "../shared/quest-journey.js";
import {
  getQuestJourneyPhaseAssigneeBriefDisplayPath,
  getQuestJourneyPhaseLeaderBriefDisplayPath,
} from "./quest-journey-phases.js";

/** Stored backend values, including the retired "claude" WebSocket type, as sessions load them. */
function loadedBackend(stored: string | undefined): BackendType | undefined {
  return stored === undefined ? undefined : normalizePersistedBackendType(stored);
}

describe("buildCompanionInstructions", () => {
  it.each([
    "claude",
    "claude-sdk",
    "codex",
  ] as const)("assembles auxiliary ownership guidance once for %s regardless of primary checkout", (stored) => {
    const backend = loadedBackend(stored);
    // Non-worktree sessions also create auxiliary checkouts. Test assembly,
    // not a snapshot of policy prose or example command strings.
    for (const worktree of [undefined, { branch: "feature", repoRoot: "/repo" }]) {
      const prompt = buildCompanionInstructions({ backend, worktree });
      expect(prompt.split(AUXILIARY_WORKTREE_INSTRUCTIONS)).toHaveLength(2);
    }
  });
  it.each([
    undefined,
    "claude",
    "claude-sdk",
    "codex",
  ] as const)("selects backend-specific sections for %s", (stored) => {
    const backend = loadedBackend(stored);
    // Section presence tests backend selection without freezing the rules inside.
    const result = buildCompanionInstructions({ backend });
    expect(result.includes("## Responding to Leaders")).toBe(backend !== "codex");
    expect(result.includes("## Native Computer Use")).toBe(backend === "codex");
    // Only Claude Code notifies the agent when a background command exits, so
    // only Claude sessions may be told to wait on one with this tool argument.
    expect(result.includes("run_in_background: true")).toBe(backend !== "codex");
  });

  it("includes session identity only when a session number is supplied", () => {
    // The identity is launch data, not a shared example's session number.
    expect(buildCompanionInstructions({ sessionNum: 42 })).toContain("You are Takode session #42.");
    expect(buildCompanionInstructions()).not.toContain("## Session Identity");
  });

  it("includes the machine section only when the launch knows the session's machine", () => {
    // The launcher supplies the machine text; assembly only places it.
    expect(buildCompanionInstructions({ machine: "Runs on `devbox`." })).toContain("## Machine\n\nRuns on `devbox`.");
    expect(buildCompanionInstructions()).not.toContain("## Machine\n");
  });

  it.each([
    "claude",
    "claude-sdk",
    "codex",
  ] as const)("includes one complete design replacement section across %s roles and checkouts", (stored) => {
    const backend = loadedBackend(stored);
    // The rule must reach leaders before dispatch and workers before Work.
    // Compare assembled content, without maintaining a second copy of its prose.
    const heading = "## Design Replacement\n\n";
    const sharedSection = buildCompanionInstructions().split(heading)[1]?.split("\n\n## ")[0];
    expect(sharedSection?.trim()).toBeTruthy();
    for (const isOrchestrator of [false, true]) {
      for (const worktree of [undefined, { branch: "feature", repoRoot: "/projects/example" }]) {
        const prompt = buildInjectedSystemPromptForDebug({ backend, isOrchestrator, worktree });
        expect(prompt.split(heading)).toHaveLength(2);
        expect(prompt).toContain(`${heading}${sharedSection}`);
      }
    }
  });

  it.each([
    "claude",
    "claude-sdk",
    "codex",
  ] as const)("includes the canonical shared link section in ordinary and leader %s prompts", (stored) => {
    const backend = loadedBackend(stored);
    // Catch omitted or truncated sections across roles/projects. Wording changes
    // update the canonical source only; this is an assembly contract.
    expect(TAKODE_LINK_SYNTAX_INSTRUCTIONS.trim()).not.toBe("");
    const prompts = [
      buildCompanionInstructions({ backend }),
      buildInjectedSystemPromptForDebug({
        backend,
        isOrchestrator: true,
        worktree: { branch: "feature", repoRoot: "/projects/example" },
      }),
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain(`## Link Syntax\n\n${TAKODE_LINK_SYNTAX_INSTRUCTIONS}`);
    }
  });

  it("keeps copyable native link examples in supported URI syntax", () => {
    // The frontend interprets these URI grammars. Do not freeze example IDs or
    // surrounding instructions, but catch malformed or retired link syntax.
    expect(TAKODE_LINK_SYNTAX_INSTRUCTIONS).toMatch(/\[q-\d+ feedback #\d+\]\(quest:q-\d+:feedback:\d+\)/);
    expect(TAKODE_LINK_SYNTAX_INSTRUCTIONS).not.toMatch(/quest:q-\d+#feedback-/);
    expect(TAKODE_LINK_SYNTAX_INSTRUCTIONS).toMatch(/\[[^\]]+\]\(file:[^)]+:\d+\)/);
  });

  it("includes worktree guardrails when worktree is provided", () => {
    const result = buildCompanionInstructions({
      worktree: { branch: "test-branch", repoRoot: "/repo" },
    });
    expect(result).toContain("Worktree Session");
    expect(result).toContain("test-branch");
    expect(result).toContain("Base branch / port target: `test-branch`");
  });

  it("uses explicit worktree port target in sync context", () => {
    const result = buildCompanionInstructions({
      worktree: {
        branch: "leader-target-wt-1234-wt-5678",
        parentBranch: "leader-target-wt-1234",
        repoRoot: "/repo",
        portTarget: {
          repoRoot: "/repo",
          branch: "leader-target-wt-1234",
          worktreePath: "/worktrees/repo/leader-target-wt-1234",
          sourceSessionNum: 7,
          sourceLabel: "#7 Leader WT",
        },
      },
    });

    expect(result).toContain("leader-target-wt-1234-wt-5678");
    expect(result).toContain("Base branch / port target: `leader-target-wt-1234`");
    expect(result).toContain("Port target worktree: `/worktrees/repo/leader-target-wt-1234`");
    expect(result).toContain("Port target source: #7 Leader WT");
  });

  it("renders explicit leader worktree targets from worker sync metadata", () => {
    const result = buildCompanionInstructions({
      worktree: {
        branch: "main-wt-5892-wt-6573",
        parentBranch: "main-wt-5892",
        repoRoot: "/Users/jiayiwei/Code/yolo",
        portTarget: {
          repoRoot: "/Users/jiayiwei/Code/yolo",
          branch: "main-wt-5892",
          worktreePath: "/Users/jiayiwei/.companion/worktrees/yolo/main-wt-5892",
          sourceSessionNum: 2468,
          sourceLabel: "#2468 QA Data Leader",
        },
      },
    });

    expect(result).toContain("Base repo checkout: `/Users/jiayiwei/Code/yolo`");
    expect(result).toContain("Base branch / port target: `main-wt-5892`");
    expect(result).toContain("Port target worktree: `/Users/jiayiwei/.companion/worktrees/yolo/main-wt-5892`");
    expect(result).toContain("Port target source: #2468 QA Data Leader");
  });

  // A worker whose port target is on another machine cannot cherry-pick into it,
  // so it gets the bundle hand-off instead of the local port workflow.
  it("selects the bundle hand-off only when the port target is on another machine", () => {
    const build = (hostId: string | undefined, targetHostId: string | undefined) =>
      buildCompanionInstructions({
        worktree: {
          branch: "main-wt-1",
          repoRoot: "/srv/app",
          ...(hostId ? { hostId } : {}),
          portTarget: { repoRoot: "/repos/app", branch: "main", ...(targetHostId ? { hostId: targetHostId } : {}) },
        },
      });

    for (const [hostId, targetHostId, bundle] of [
      ["host-1", undefined, true],
      [undefined, "host-1", true],
      ["host-1", "host-2", true],
      ["host-1", "host-1", false],
      [undefined, undefined, false],
    ] as const) {
      const result = build(hostId, targetHostId);
      expect({ hostId, targetHostId, bundle: result.includes("takode bundle send") }).toEqual({
        hostId,
        targetHostId,
        bundle,
      });
      expect(result.includes("Use `/port-changes`")).toBe(!bundle);
    }
  });

  it("appends caller instructions unchanged", () => {
    // Caller-provided content must survive composition, including its own markup.
    const extraInstructions = "Custom context\n`literal syntax` and **formatting**";
    expect(buildCompanionInstructions({ extraInstructions }).endsWith(extraInstructions)).toBe(true);
  });
});

describe("getOrchestratorGuardrails", () => {
  it("defaults to the Claude guardrails, including for sessions stored with the retired type", () => {
    expect(getOrchestratorGuardrails()).toBe(getOrchestratorGuardrails("claude-sdk"));
    expect(getOrchestratorGuardrails(normalizePersistedBackendType("claude"))).toBe(
      getOrchestratorGuardrails("claude-sdk"),
    );
  });

  it("selects the tool invocation syntax supported by each backend", () => {
    // A swapped backend branch would teach calls to unavailable tools. These
    // exact tool/argument tokens are intentional contracts, not prose preferences.
    const claude = getOrchestratorGuardrails("claude-sdk");
    const codex = getOrchestratorGuardrails("codex");
    expect(claude).toContain("run_in_background: true");
    expect(claude).not.toContain("delegate_task(task)");
    expect(codex).toContain("delegate_task(task)");
    expect(codex).not.toContain("run_in_background: true");
  });

  it.each(["claude", "codex"] as const)("assembles the current phase catalog into %s guidance", (stored) => {
    const backend = loadedBackend(stored);
    // Paths and board states must follow the live catalog instead of stale copied
    // phase data; the prose of each phase remains owned by its canonical source.
    const result = getOrchestratorGuardrails(backend);
    for (const phase of QUEST_JOURNEY_PHASES) {
      expect(result).toContain(`| ${phase.label} | \`${phase.boardState}\` |`);
      expect(result).toContain(getQuestJourneyPhaseLeaderBriefDisplayPath(phase.id));
      expect(result).toContain(getQuestJourneyPhaseAssigneeBriefDisplayPath(phase.id));
    }
  });
});

describe("buildInjectedSystemPromptForDebug", () => {
  it.each(["claude", "claude-sdk", "codex"] as const)("adds leader guardrails only to %s leaders", (stored) => {
    const backend = loadedBackend(stored);
    // Preserve the complete shared prompt for both roles, then append the selected
    // leader guardrails. Compare canonical assembly without copying static prose.
    const guardrails = getOrchestratorGuardrails(backend);
    const worker = buildInjectedSystemPromptForDebug({ sessionNum: 8, backend });
    const leader = buildInjectedSystemPromptForDebug({ sessionNum: 8, backend, isOrchestrator: true });
    expect(worker).toBe(buildCompanionInstructions({ sessionNum: 8, backend }));
    expect(worker).not.toContain("## Leader Thread Routing");
    expect(leader).toBe(`${worker}\n\n${guardrails}`);
    expect(leader.includes("## Native Computer Use")).toBe(backend === "codex");
  });

  it("preserves caller context after the selected leader guardrails", () => {
    const extraInstructions = "Context for this launch\nKeep `source text` intact.";
    const result = buildInjectedSystemPromptForDebug({ backend: "codex", isOrchestrator: true, extraInstructions });
    expect(result.endsWith(`${getOrchestratorGuardrails("codex")}\n\n${extraInstructions}`)).toBe(true);
  });
});
