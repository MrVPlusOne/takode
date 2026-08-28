import { useEffect } from "react";
import type {
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatusCounts,
} from "../../../shared/codex-native-subagent-types.js";
import type { ChatMessage, SessionState } from "../../types.js";
import { useStore } from "../../store.js";
import { CodexSubagentFeedControl } from "../CodexSubagentFeedControl.js";
import type { CodexTerminalEntry } from "../MessageFeedLiveActivity.js";
import { MessageFeedTopControls } from "../MessageFeedTopControls.js";
import { CodexSubagentInspector } from "../CodexSubagentInspector.js";
import { CodexSubagentTranscript } from "../CodexSubagentTranscript.js";
import { CodexSubagentTurnSegment } from "../CodexSubagentTurnSegment.js";
import { Card, Section } from "./shared.js";

const SESSION_ID = "playground-codex-native-subagents";
const MISSING_SESSION_ID = "playground-codex-native-subagents-missing";
const COMPLETE_ZERO_SESSION_ID = "playground-codex-native-subagents-complete-zero";
const PARTIAL_ZERO_SESSION_ID = "playground-codex-native-subagents-partial-zero";
const UNKNOWN_CHILD_SESSION_ID = "playground-codex-native-subagents-unknown-child";
const ACTIVE_TURN = "playground-turn-active";
const SETTLED_TURN = "playground-turn-settled";
const PLAYGROUND_OWNERSHIP = { childId: "csa-playground-1", rootTurnId: ACTIVE_TURN };
const PLAYGROUND_TERMINAL: CodexTerminalEntry = {
  toolUseId: "playground-live-terminal",
  input: { command: "bun test" },
  timestamp: Date.now() - 12_000,
  preview: "bun test",
  result: null,
  progress: { elapsedSeconds: 12 },
};
const NOOP = () => {};

function counts(values: Partial<CodexNativeSubagentStatusCounts>): CodexNativeSubagentStatusCounts {
  return {
    starting: 0,
    working: 0,
    waiting: 0,
    done: 0,
    failed: 0,
    interrupted: 0,
    unknown: 0,
    ...values,
  };
}

const snapshot: CodexNativeSubagentSnapshot = {
  revision: 7,
  coverage: "partial",
  session: {
    total: 6,
    statusCounts: counts({ working: 1, waiting: 1, done: 1, failed: 1, interrupted: 1, unknown: 1 }),
    activeCount: 2,
    unresolvedCount: 3,
  },
  turns: {
    [ACTIVE_TURN]: {
      rootTurnId: ACTIVE_TURN,
      total: 2,
      statusCounts: counts({ working: 1, waiting: 1 }),
      status: "working",
      coverage: "complete",
    },
    [SETTLED_TURN]: {
      rootTurnId: SETTLED_TURN,
      total: 4,
      statusCounts: counts({ done: 1, failed: 1, interrupted: 1, unknown: 1 }),
      status: "failed",
      coverage: "partial",
    },
  },
  children: [
    {
      childId: "csa-playground-1",
      rootTurnId: ACTIVE_TURN,
      agentPath: "/root/schema_audit",
      displayName: "schema_audit",
      nickname: "Ada",
      role: "Explorer",
      depth: 1,
      spawnOrder: 1,
      startedAt: Date.now() - 90_000,
      lastActivityAt: Date.now() - 4_000,
      status: "working",
      statusObservedAt: Date.now() - 4_000,
      transcriptAvailability: "available",
      followUpAvailable: true,
    },
    {
      childId: "csa-playground-2",
      parentChildId: "csa-playground-1",
      rootTurnId: ACTIVE_TURN,
      agentPath: "/root/schema_audit/privacy_check",
      displayName: "privacy_check",
      nickname: "Noether",
      role: "Reviewer",
      depth: 2,
      spawnOrder: 2,
      startedAt: Date.now() - 54_000,
      lastActivityAt: Date.now() - 12_000,
      status: "waiting",
      statusObservedAt: Date.now() - 12_000,
      transcriptAvailability: "partial",
    },
    {
      childId: "csa-playground-3",
      rootTurnId: SETTLED_TURN,
      agentPath: "/root/ui_contract",
      displayName: "ui_contract",
      nickname: "Mendel",
      depth: 1,
      spawnOrder: 3,
      endedAt: Date.now() - 8 * 60_000,
      lastActivityAt: Date.now() - 8 * 60_000,
      status: "done",
      statusObservedAt: Date.now() - 8 * 60_000,
      transcriptAvailability: "available",
    },
    {
      childId: "csa-playground-4",
      rootTurnId: SETTLED_TURN,
      agentPath: "/root/failure_probe",
      displayName: "failure_probe",
      depth: 1,
      spawnOrder: 4,
      endedAt: Date.now() - 6 * 60_000,
      status: "failed",
      statusObservedAt: Date.now() - 6 * 60_000,
      transcriptAvailability: "partial",
    },
    {
      childId: "csa-playground-5",
      rootTurnId: SETTLED_TURN,
      agentPath: "/root/interrupted_probe",
      displayName: "interrupted_probe",
      depth: 1,
      spawnOrder: 5,
      endedAt: Date.now() - 5 * 60_000,
      status: "interrupted",
      statusObservedAt: Date.now() - 5 * 60_000,
      transcriptAvailability: "unavailable",
    },
    {
      childId: "csa-playground-6",
      rootTurnId: SETTLED_TURN,
      agentPath: "/root/legacy_unknown",
      displayName: "legacy_unknown",
      depth: 1,
      spawnOrder: 6,
      status: "unknown",
      statusObservedAt: Date.now() - 3 * 60_000,
      transcriptAvailability: "unavailable",
    },
  ],
};

const unknownChildSnapshot: CodexNativeSubagentSnapshot = {
  revision: 8,
  coverage: "partial",
  session: {
    total: 1,
    statusCounts: counts({ unknown: 1 }),
    activeCount: 0,
    unresolvedCount: 1,
  },
  turns: {
    [SETTLED_TURN]: {
      rootTurnId: SETTLED_TURN,
      total: 1,
      statusCounts: counts({ unknown: 1 }),
      status: "unknown",
      coverage: "partial",
    },
  },
  children: [snapshot.children[5]],
};

function emptySnapshot(coverage: CodexNativeSubagentSnapshot["coverage"]): CodexNativeSubagentSnapshot {
  return {
    revision: 1,
    coverage,
    session: {
      total: 0,
      statusCounts: counts({}),
      activeCount: 0,
      unresolvedCount: 0,
    },
    turns: {},
    children: [],
  };
}

const transcriptMessages: ChatMessage[] = [
  {
    id: "playground-child-message",
    role: "assistant",
    content: "The child found the producer contract and is checking its result.",
    contentBlocks: [{ type: "text", text: "The child found the producer contract and is checking its result." }],
    timestamp: Date.now() - 25_000,
    metadata: { codexSubagent: PLAYGROUND_OWNERSHIP },
  },
  {
    id: "playground-child-reasoning-1",
    role: "assistant",
    content: "**Inspecting schema**\nComparing the server-owned shape.",
    timestamp: Date.now() - 20_000,
    metadata: {
      codexSubagent: PLAYGROUND_OWNERSHIP,
      codexReasoningDetail: { status: "complete", reasoningTurnId: "playground-reasoning-turn" },
    },
  },
  {
    id: "playground-child-reasoning-2",
    role: "assistant",
    content: "**Checking result**\nThe bounded result matches the expected fields.",
    timestamp: Date.now() - 18_000,
    metadata: {
      codexSubagent: PLAYGROUND_OWNERSHIP,
      codexReasoningDetail: { status: "complete", reasoningTurnId: "playground-reasoning-turn" },
    },
  },
  {
    id: "playground-child-tool",
    role: "assistant",
    content: "",
    contentBlocks: [
      { type: "tool_use", id: "playground-read-tool", name: "Read", input: { file_path: "src/example.ts" } },
      {
        type: "tool_result",
        tool_use_id: "playground-read-tool",
        content: "export const producerShape = true;",
        is_error: false,
      },
    ],
    timestamp: Date.now() - 12_000,
    metadata: { codexSubagent: PLAYGROUND_OWNERSHIP },
  },
];

function playgroundSession(
  sessionId = SESSION_ID,
  nativeSnapshot: CodexNativeSubagentSnapshot | null = snapshot,
): SessionState {
  return {
    session_id: sessionId,
    backend_type: "codex",
    model: "gpt-5.6",
    cwd: "",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 2,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...(nativeSnapshot ? { codex_native_subagents: nativeSnapshot } : {}),
  };
}

export function PlaygroundCodexSubagentStates() {
  const openInspector = useStore((state) => state.openCodexSubagentInspector);

  useEffect(() => {
    useStore.setState((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(SESSION_ID, playgroundSession());
      sessions.set(MISSING_SESSION_ID, {
        ...playgroundSession(MISSING_SESSION_ID, null),
        isOrchestrator: true,
      });
      sessions.set(COMPLETE_ZERO_SESSION_ID, playgroundSession(COMPLETE_ZERO_SESSION_ID, emptySnapshot("complete")));
      sessions.set(PARTIAL_ZERO_SESSION_ID, playgroundSession(PARTIAL_ZERO_SESSION_ID, emptySnapshot("partial")));
      sessions.set(UNKNOWN_CHILD_SESSION_ID, playgroundSession(UNKNOWN_CHILD_SESSION_ID, unknownChildSnapshot));
      return { sessions };
    });
    return () => {
      useStore.getState().closeCodexSubagentInspector();
      useStore.setState((state) => {
        const sessions = new Map(state.sessions);
        sessions.delete(SESSION_ID);
        sessions.delete(MISSING_SESSION_ID);
        sessions.delete(COMPLETE_ZERO_SESSION_ID);
        sessions.delete(PARTIAL_ZERO_SESSION_ID);
        sessions.delete(UNKNOWN_CHILD_SESSION_ID);
        return { sessions };
      });
    };
  }, []);

  return (
    <Section
      title="Codex subagents"
      description="Feed-local access, distinct native-child turn counts, and canonical read-only transcript rendering"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Active turn — complete coverage">
          <div className="border-t border-cc-border bg-cc-card p-4">
            <CodexSubagentTurnSegment sessionId={SESSION_ID} turnId={ACTIVE_TURN} />
          </div>
        </Card>
        <Card label="Settled turn — partial legacy coverage">
          <div className="border-t border-cc-border bg-cc-card p-4">
            <CodexSubagentTurnSegment sessionId={SESSION_ID} turnId={SETTLED_TURN} />
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card label="Genuine child plus live activity — shared floating rail">
          <div
            className="relative min-h-32 overflow-hidden border-t border-cc-border bg-cc-bg"
            data-testid="playground-codex-subagent-shared-rail"
          >
            <MessageFeedTopControls
              sessionId={SESSION_ID}
              terminals={[PLAYGROUND_TERMINAL]}
              subagents={[]}
              selectedToolUseId={null}
              onSelect={NOOP}
              onSelectSubagent={NOOP}
              onDismissSubagent={NOOP}
            />
            <div className="max-w-md px-4 py-4 text-xs leading-relaxed text-cc-muted">
              Chat content starts at the feed edge instead of below a reserved control row. Live activity and the
              native-child chip share one collision-free overlay rail.
              <div className="mt-3 rounded-lg border border-cc-border bg-cc-card p-3 text-cc-fg">
                Representative first message content remains in the same vertical flow.
              </div>
            </div>
          </div>
        </Card>
        <Card label="Missing and zero child data — controls hidden">
          <div
            className="grid gap-2 border-t border-cc-border bg-cc-bg p-3 text-xs text-cc-muted"
            data-testid="playground-codex-subagent-hidden-states"
          >
            {[
              [MISSING_SESSION_ID, "Missing snapshot"],
              [COMPLETE_ZERO_SESSION_ID, "Complete zero"],
              [PARTIAL_ZERO_SESSION_ID, "Partial zero"],
            ].map(([sessionId, label]) => (
              <div key={sessionId} className="relative min-h-12 rounded-lg border border-cc-border bg-cc-card p-3">
                <CodexSubagentFeedControl sessionId={sessionId} />
                {label}: no empty or unknown chip should appear.
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card label="Genuine unknown child — visible partial chip">
          <div
            className="relative min-h-24 overflow-hidden border-t border-cc-border bg-cc-bg p-4 text-xs text-cc-muted"
            data-testid="playground-codex-subagent-unknown-child"
          >
            <MessageFeedTopControls
              sessionId={UNKNOWN_CHILD_SESSION_ID}
              terminals={[]}
              subagents={[]}
              selectedToolUseId={null}
              onSelect={NOOP}
              onSelectSubagent={NOOP}
              onDismissSubagent={NOOP}
            />
            A verified child remains inspectable even when its lifecycle and transcript coverage are unresolved.
          </div>
        </Card>
        <Card label="Canonical child transcript surfaces">
          <div className="max-h-96 overflow-y-auto border-t border-cc-border bg-cc-bg p-4">
            <CodexSubagentTranscript sessionId={SESSION_ID} messages={transcriptMessages} />
          </div>
        </Card>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openInspector(SESSION_ID, { scopeTurnId: SETTLED_TURN })}
          className="min-h-10 rounded-lg border border-cc-border bg-cc-card px-4 text-xs font-medium text-cc-fg hover:bg-cc-hover"
        >
          Open partial turn inspector
        </button>
      </div>
      <CodexSubagentInspector sessionId={SESSION_ID} />
    </Section>
  );
}
