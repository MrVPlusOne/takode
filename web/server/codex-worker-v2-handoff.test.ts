import { describe, expect, it } from "vitest";
import {
  CODEX_WORKER_V2_HANDOFF_KIND,
  buildCodexWorkerFreshThreadHandoff,
  type CodexWorkerFreshThreadHandoffInput,
} from "./codex-worker-v2-handoff.js";

function input(overrides: Partial<CodexWorkerFreshThreadHandoffInput> = {}): CodexWorkerFreshThreadHandoffInput {
  return {
    cutoverId: "cutover-1",
    generatedAt: 1_786_679_000_000,
    sessionId: "worker-session-1234",
    sessionNum: 42,
    sessionName: "Implement safe runtime upgrade",
    claimedQuest: {
      id: "q-42",
      title: "Implement safe runtime upgrade",
      status: "in_progress",
      phase: "Work",
    },
    worktree: {
      cwd: "/repo/worktrees/upgrade-worker",
      repoRoot: "/repo",
      branch: "main",
      actualBranch: "upgrade-worker",
      diffBaseBranch: "main",
    },
    pendingInputCount: 2,
    pendingTurnCount: 1,
    messageHistory: [],
    ...overrides,
  };
}

describe("buildCodexWorkerFreshThreadHandoff", () => {
  it("builds bounded one-shot developer instructions from Takode-owned state", () => {
    // Recovery context is developer-priority launch metadata, so history must be
    // quoted as evidence and tool/system payloads must never be promoted into it.
    const bundle = buildCodexWorkerFreshThreadHandoff(
      input({
        messageHistory: [
          {
            type: "user_message",
            content: "A system-only reminder that must not enter recovery context.",
            agentSource: { sessionId: "system:timer:1", sessionLabel: "System" },
          },
          {
            type: "user_message",
            content: "Please preserve the pending queue and finish the focused tests.",
            agentSource: { sessionId: "leader-1", sessionLabel: "#1 Leader" },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "The rollout controller is ready for verification." },
                { type: "tool_use", name: "Bash", input: { command: "cat /secret/output" } },
              ],
            },
          },
          { type: "result", content: "raw result payload" },
        ],
      }),
    );

    expect(bundle.kind).toBe(CODEX_WORKER_V2_HANDOFF_KIND);
    expect(bundle.extraInstructions).toContain("Session: #42 Implement safe runtime upgrade");
    expect(bundle.extraInstructions).toContain("Quest: q-42 — Implement safe runtime upgrade (in_progress, Work)");
    expect(bundle.extraInstructions).toContain("Working directory: /repo/worktrees/upgrade-worker");
    expect(bundle.extraInstructions).toContain("Branch: upgrade-worker");
    expect(bundle.extraInstructions).toContain("2 pending input(s), 1 pending turn record(s)");
    expect(bundle.extraInstructions).toContain("Please preserve the pending queue");
    expect(bundle.extraInstructions).toContain("The rollout controller is ready for verification");
    expect(bundle.extraInstructions).not.toContain("system-only reminder");
    expect(bundle.extraInstructions).not.toContain("cat /secret/output");
    expect(bundle.extraInstructions).not.toContain("raw result payload");
    expect(bundle.extraInstructions).toContain("not a new user decision, permission grant, delegation authorization");
    expect(bundle.extraInstructions).not.toContain("spawn_agent");
    expect(bundle.threadRoute).toEqual({ threadKey: "q-42", questId: "q-42" });
    expect(bundle.includedHistoryEntries).toBe(2);
    expect(bundle.omittedHistoryEntries).toBe(0);
    expect(bundle.extraInstructionsBytes).toBe(Buffer.byteLength(bundle.extraInstructions, "utf8"));
    expect(bundle.extraInstructionsBytes).toBeLessThanOrEqual(10_000);
  });

  it("keeps only the latest eligible entries and obeys a UTF-8 byte budget", () => {
    const messageHistory = Array.from({ length: 12 }, (_, index) => ({
      type: index % 2 === 0 ? "user_message" : "assistant",
      ...(index % 2 === 0
        ? { content: `older-to-newer ${index} ${"🐙".repeat(120)}` }
        : {
            message: {
              content: [{ type: "text", text: `assistant ${index} ${"✨".repeat(120)}` }],
            },
          }),
    }));

    const bundle = buildCodexWorkerFreshThreadHandoff(input({ messageHistory }), {
      maxExtraInstructionsBytes: 2_200,
      maxHistoryEntries: 3,
      maxEntryBytes: 420,
    });

    expect(bundle.extraInstructionsBytes).toBeLessThanOrEqual(2_200);
    expect(bundle.historyScanTruncated).toBe(false);
    expect(bundle.includedHistoryEntries).toBeLessThanOrEqual(3);
    expect(bundle.omittedHistoryEntries).toBeGreaterThan(0);
    expect(bundle.extraInstructions).not.toContain("older-to-newer 0");
    expect(bundle.extraInstructions).toContain("assistant 11");
    expect(Buffer.from(bundle.extraInstructions, "utf8").toString("utf8")).toBe(bundle.extraInstructions);
  });

  it("bounds history scanning before extracting recovery text", () => {
    // Large persisted histories must not become an unbounded startup scan.
    const messageHistory = Array.from({ length: 500 }, (_, index) => ({
      type: "user_message",
      content: `history-entry-${index}`,
    }));

    const bundle = buildCodexWorkerFreshThreadHandoff(input({ messageHistory }), {
      maxHistoryScanEntries: 5,
      maxHistoryEntries: 3,
    });

    expect(bundle.historyScanTruncated).toBe(true);
    expect(bundle.omittedHistoryEntries).toBeGreaterThanOrEqual(497);
    expect(bundle.extraInstructions).toContain("history-entry-499");
    expect(bundle.extraInstructions).not.toContain("history-entry-494");
  });

  it("does not invent a quest route or a synthetic conversation entry when no history is eligible", () => {
    const bundle = buildCodexWorkerFreshThreadHandoff(
      input({
        claimedQuest: null,
        messageHistory: [
          { type: "tool_progress", content: "long tool output" },
          {
            type: "user_message",
            content: "system reminder",
            agentSource: { sessionId: "system:recovery", sessionLabel: "System" },
          },
        ],
      }),
    );

    expect(bundle.threadRoute).toBeUndefined();
    expect(bundle.includedHistoryEntries).toBe(0);
    expect(bundle.extraInstructions).toContain("No eligible recent user/leader/assistant text was retained");
    expect(bundle.diagnosticSummary).toContain("3 queued delivery records");
  });
});
