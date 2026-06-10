import { describe, expect, it, vi } from "vitest";
import { prepareCodexLeaderRecycleSession } from "./codex-leader-recycle-controller.js";
import { injectCompactionRecovery } from "./compaction-recovery.js";
import type { BrowserIncomingMessage } from "../session-types.js";

function makeLeaderSession(history: BrowserIncomingMessage[]) {
  return {
    id: "leader-session",
    state: { is_compacting: false },
    messageHistory: history,
    pendingMessages: ["old"],
    pendingCodexTurns: [{ userMessageId: "old-turn" }],
    pendingCodexInputs: [{ id: "old-input" }],
    pendingCodexRollback: { numTurns: 1, truncateIdx: 1, clearCodexState: false },
    pendingCodexRollbackError: "old rollback error",
    pendingCodexRollbackWaiter: null,
    pendingPermissions: new Map([["perm-1", {}]]),
    pendingQuestCommands: new Map([["tool-1", {}]]),
    codexFreshTurnRequiredUntilTurnId: "turn-old",
    lastOutboundUserNdjson: "old outbound",
    activeTurnRoute: { threadKey: "q-1489", questId: "q-1489" },
    sessionNum: 42,
    interruptedDuringTurn: false,
    interruptSourceDuringTurn: null,
    relaunchPending: false,
    forceCompactPending: true,
    codexLeaderRecycleContinuation: null,
  } as any;
}

function makeDeps() {
  return {
    clearAllCodexToolResultWatchdogs: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    markCodexIntentionalRelaunch: vi.fn(),
    persistSession: vi.fn(),
    replaceQueuedTurnLifecycleEntries: vi.fn(),
    setGenerating: vi.fn(),
  };
}

describe("Codex leader recycle continuation", () => {
  it("injects a specific stopped-after-tools leader continuation even when old compaction recovery exists", () => {
    // Regression for q-1494 and q-1500: a leader recycled after tool
    // activity while preparing a quest-design/dispatch approval surface. The
    // continuation must be delivered once after the recycle marker, but it
    // must point the next leader at inspection tools instead of copying recent
    // assistant/tool snippets into the prompt.
    const history: BrowserIncomingMessage[] = [
      {
        type: "compact_marker",
        id: "old-compact",
        timestamp: 1,
      },
      {
        type: "user_message",
        id: "old-recovery",
        timestamp: 2,
        content: "Context was compacted. Before continuing, recover enough context to safely resume orchestration:",
        agentSource: { sessionId: "system:compaction-recovery", sessionLabel: "Compaction Recovery" },
      },
      {
        type: "user_message",
        id: "user-q1489",
        timestamp: 3,
        content: 'The 3 memory commits in q-1489 are currently shown as "not available". This is likely a bug.',
        threadKey: "q-1489",
        questId: "q-1489",
      },
      {
        type: "assistant",
        timestamp: 4,
        parent_tool_use_id: null,
        threadKey: "q-1489",
        questId: "q-1489",
        message: {
          id: "assistant-partial",
          type: "message",
          role: "assistant",
          model: "gpt-5.5",
          content: [
            {
              type: "text",
              text: "This looks separate from q-1491; I’m going to propose it as a follow-up of q-1489.",
            },
            {
              type: "tool_use",
              id: "call-bash",
              name: "Bash",
              input: { command: "quest show q-1489" },
            },
          ],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "call-info",
            content: "#2025 Fix Codex active-turn steering mismatch recovery",
            is_error: false,
            total_size: 55,
            is_truncated: false,
          },
        ],
      },
    ];
    const session = makeLeaderSession(history);
    const deps = makeDeps();

    prepareCodexLeaderRecycleSession(session, "threshold", 15_000, deps);

    expect(session.pendingMessages).toEqual([]);
    expect(session.pendingCodexTurns).toEqual([]);
    expect(session.pendingCodexInputs).toEqual([]);
    expect(session.interruptedDuringTurn).toBe(true);
    const recycleMarker = session.messageHistory.at(-1)!;
    expect(recycleMarker).toMatchObject({
      type: "compact_marker",
      markerKind: "session_recycled",
      trigger: "threshold",
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, recycleMarker);
    expect(session.codexLeaderRecycleContinuation?.content).toContain("interrupted the previous leader turn");
    expect(session.codexLeaderRecycleContinuation?.content).toContain(
      "Do not treat any partial assistant text before this message as a completed continuation.",
    );
    expect(session.codexLeaderRecycleContinuation?.content).toContain(
      "Load skills: /takode-orchestration, /leader-dispatch, and /quest",
    );
    expect(session.codexLeaderRecycleContinuation?.content).toContain("takode leader-context-resume 42");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("takode scan 42");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("takode peek 42");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("takode read 42 <msg-id>");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("quest show");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("quest status");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("memory catalog show");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("takode board show");
    expect(session.codexLeaderRecycleContinuation?.content).toContain("q-1489");
    expect(session.codexLeaderRecycleContinuation?.content).not.toContain("Recent visible context before recycle");
    expect(session.codexLeaderRecycleContinuation?.content).not.toContain("This looks separate from q-1491");
    expect(session.codexLeaderRecycleContinuation?.content).not.toContain("tool:Bash");
    expect(session.codexLeaderRecycleContinuation?.content).not.toContain("quest show q-1489");
    expect(session.codexLeaderRecycleContinuation?.content).not.toContain("Fix Codex active-turn");

    const injectUserMessage = vi.fn(
      (_sessionId: string, content: string, agentSource?: { sessionId: string; sessionLabel?: string | undefined }) => {
        session.messageHistory.push({
          type: "user_message",
          id: "recycle-continuation",
          timestamp: Date.now(),
          content,
          ...(agentSource ? { agentSource } : {}),
        });
      },
    );
    injectCompactionRecovery(session, {
      isLeaderSession: () => true,
      isSystemSourceTag: (agentSource) => agentSource?.sessionId === "system:compaction-recovery",
      injectUserMessage,
    });

    expect(session.codexLeaderRecycleContinuation).toBeNull();
    expect(injectUserMessage).toHaveBeenCalledTimes(1);
    const [, content, source] = injectUserMessage.mock.calls[0]!;
    expect(content).toContain(
      "Do not treat any partial assistant text before this message as a completed continuation.",
    );
    expect(content).toContain("continue the interrupted workflow");
    expect(content).toContain("Load skills: /takode-orchestration, /leader-dispatch, and /quest");
    expect(content).toContain("takode leader-context-resume 42");
    expect(content).toContain("takode scan 42");
    expect(content).toContain("takode peek 42");
    expect(content).toContain("takode read 42 <msg-id>");
    expect(content).toContain("quest show");
    expect(content).toContain("quest status");
    expect(content).toContain("memory catalog show");
    expect(content).toContain("takode board show");
    expect(content).toContain("q-1489");
    expect(content).not.toContain("Recent visible context before recycle");
    expect(content).not.toContain("This looks separate from q-1491");
    expect(content).not.toContain("tool:Bash");
    expect(content).not.toContain("quest show q-1489");
    expect(content).not.toContain("Fix Codex active-turn");
    expect(source).toEqual({
      sessionId: "system:compaction-recovery",
      sessionLabel: "Compaction Recovery",
    });
    const markerIndex = session.messageHistory.indexOf(recycleMarker);
    const continuationIndex = session.messageHistory.findIndex(
      (entry: { id?: string }) => entry.id === "recycle-continuation",
    );
    expect(continuationIndex).toBe(markerIndex + 1);

    injectCompactionRecovery(session, {
      isLeaderSession: () => true,
      isSystemSourceTag: (agentSource) => agentSource?.sessionId === "system:compaction-recovery",
      injectUserMessage,
    });
    expect(injectUserMessage).toHaveBeenCalledTimes(1);
  });
});
