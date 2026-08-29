import { useEffect } from "react";
import type {
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatusCounts,
} from "../../../shared/codex-native-subagent-types.js";
import type { BrowserIncomingMessage, ChatMessage, SessionState } from "../../types.js";
import type {
  CodexNativeSubagentHistoryPage,
  FetchCodexNativeSubagentHistoryOptions,
} from "../../api/codex-native-subagents.js";
import { useStore } from "../../store.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { CodexSubagentFeedControl } from "../CodexSubagentFeedControl.js";
import type { CodexTerminalEntry } from "../MessageFeedLiveActivity.js";
import { MessageFeedTopControls } from "../MessageFeedTopControls.js";
import { MessageFeed } from "../MessageFeed.js";
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
const PLAYGROUND_OWNERSHIP = {
  childId: "csa-playground-1",
  rootTurnId: ACTIVE_TURN,
};
const PLAYGROUND_HISTORY_CURSOR = "playground-older-history";
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
    total: 10,
    statusCounts: counts({
      working: 1,
      waiting: 1,
      done: 5,
      failed: 1,
      interrupted: 1,
      unknown: 1,
    }),
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
      total: 8,
      statusCounts: counts({ done: 5, failed: 1, interrupted: 1, unknown: 1 }),
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
      agentPath: "/root/schema_audit/privacy_and_canonical_rendering_regression_check",
      displayName: "privacy_and_canonical_rendering_regression_check",
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
    ...Array.from({ length: 4 }, (_, index) => ({
      childId: `csa-playground-history-${index + 1}`,
      rootTurnId: SETTLED_TURN,
      agentPath: `/root/completed_validation_${index + 1}`,
      displayName: `completed_validation_${index + 1}`,
      ...(index % 2 === 0 ? {} : { parentChildId: "csa-playground-3" }),
      depth: index % 2 === 0 ? 1 : 2,
      spawnOrder: 7 + index,
      endedAt: Date.now() - (12 + index) * 60_000,
      lastActivityAt: Date.now() - (12 + index) * 60_000,
      status: "done" as const,
      statusObservedAt: Date.now() - (12 + index) * 60_000,
      transcriptAvailability: "available" as const,
    })),
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
    contentBlocks: [
      {
        type: "text",
        text: "The child found the producer contract and is checking its result.",
      },
    ],
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
      codexReasoningDetail: {
        status: "complete",
        reasoningTurnId: "playground-reasoning-turn",
      },
    },
  },
  {
    id: "playground-child-reasoning-2",
    role: "assistant",
    content: "**Checking result**\nThe bounded result matches the expected fields.",
    timestamp: Date.now() - 18_000,
    metadata: {
      codexSubagent: PLAYGROUND_OWNERSHIP,
      codexReasoningDetail: {
        status: "complete",
        reasoningTurnId: "playground-reasoning-turn",
      },
    },
  },
  {
    id: "playground-child-tool",
    role: "assistant",
    content: "",
    contentBlocks: [
      {
        type: "tool_use",
        id: "playground-read-tool",
        name: "Read",
        input: { file_path: "src/example.ts" },
      },
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

function playgroundCanonicalChildHistory(childId: string, rootTurnId: string): BrowserIncomingMessage[] {
  const codexSubagent = { childId, rootTurnId };
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  return [
    {
      type: "assistant",
      message: {
        id: `${childId}-answer`,
        type: "message",
        role: "assistant",
        model: "gpt-5.6",
        content: [{ type: "text", text: "Child-only answer stays in the inspector." }],
        stop_reason: "end_turn",
        usage,
      },
      parent_tool_use_id: null,
      timestamp: Date.now() - 28_000,
      codexSubagent,
    },
    {
      type: "codex_reasoning_detail",
      id: `${childId}-reasoning-1`,
      text: "**Child-only reasoning**\nThis official summary belongs in the inspector.",
      status: "complete",
      timestamp: Date.now() - 26_000,
      parent_tool_use_id: null,
      reasoning_turn_id: `${childId}-reasoning-turn`,
      summary_index: 0,
      codexSubagent,
    },
    {
      type: "codex_reasoning_detail",
      id: `${childId}-reasoning-2`,
      text: "**Checking child result**\nThe exact child-owned result remains bounded and readable.",
      status: "complete",
      timestamp: Date.now() - 25_000,
      parent_tool_use_id: null,
      reasoning_turn_id: `${childId}-reasoning-turn`,
      summary_index: 1,
      codexSubagent,
    },
    {
      type: "assistant",
      message: {
        id: `${childId}-tool`,
        type: "message",
        role: "assistant",
        model: "gpt-5.6",
        content: [
          {
            type: "tool_use",
            id: `${childId}-read`,
            name: "Read",
            input: { file_path: "src/child-only.ts" },
          },
          {
            type: "tool_result",
            tool_use_id: `${childId}-read`,
            content: "child-only tool result",
          },
        ],
        stop_reason: "end_turn",
        usage,
      },
      parent_tool_use_id: null,
      timestamp: Date.now() - 24_000,
      codexSubagent,
    },
    {
      type: "error",
      id: `${childId}-error`,
      message: "Child-only failure stays in the inspector.",
      timestamp: Date.now() - 22_000,
      codexSubagent,
    },
  ];
}

const PLAYGROUND_CANONICAL_CHILD_HISTORY = playgroundCanonicalChildHistory(
  PLAYGROUND_OWNERSHIP.childId,
  PLAYGROUND_OWNERSHIP.rootTurnId,
);

const rootOnlyFeedMessages: ChatMessage[] = [
  {
    id: ACTIVE_TURN,
    role: "user",
    content: "Show only the root agent's activity here.",
    timestamp: Date.now() - 30_000,
  },
  ...PLAYGROUND_CANONICAL_CHILD_HISTORY.flatMap((message, index) =>
    normalizeHistoryMessageToChatMessages(message, index + 1, { includeSuccessfulResult: true }),
  ),
  {
    id: "playground-root-reasoning-1",
    role: "assistant",
    content: "**Reviewing root projection**\nOnly root-owned details can enter this group.",
    timestamp: Date.now() - 20_000,
    metadata: {
      codexReasoningDetail: { status: "complete", reasoningTurnId: "playground-root-reasoning-turn" },
    },
  },
  {
    id: "playground-root-reasoning-2",
    role: "assistant",
    content: "**Confirming root-only activity**\nThe child transcript remains available separately.",
    timestamp: Date.now() - 18_000,
    metadata: {
      codexReasoningDetail: { status: "complete", reasoningTurnId: "playground-root-reasoning-turn" },
    },
  },
  {
    id: "playground-root-settled-tool",
    role: "assistant",
    content: "",
    contentBlocks: [
      { type: "tool_use", id: "playground-root-settled", name: "Bash", input: { command: "git status --short" } },
    ],
    timestamp: Date.now() - 16_000,
  },
  {
    id: "playground-root-live-tool",
    role: "assistant",
    content: "",
    contentBlocks: [
      { type: "tool_use", id: "playground-root-live", name: "Bash", input: { command: "tail -f root-agent.log" } },
    ],
    timestamp: Date.now() - 14_000,
  },
];

function playgroundHistoryMessage(
  childId: string,
  rootTurnId: string,
  id: string,
  content: string,
  timestamp: number,
): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content,
    timestamp,
    codexSubagent: { childId, rootTurnId },
  };
}

async function loadPlaygroundHistory({
  childId,
  cursor,
  signal,
}: FetchCodexNativeSubagentHistoryOptions): Promise<CodexNativeSubagentHistoryPage> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const child = snapshot.children.find((candidate) => candidate.childId === childId) ?? snapshot.children[0]!;
  const rootTurnId = child.rootTurnId;
  const partial = child.transcriptAvailability !== "available";
  if (childId === PLAYGROUND_OWNERSHIP.childId && cursor == null) {
    return {
      messages: PLAYGROUND_CANONICAL_CHILD_HISTORY,
      nextCursor: null,
      availability: "available",
      coverage: "complete",
    };
  }
  if (cursor === PLAYGROUND_HISTORY_CURSOR) {
    return {
      messages: Array.from({ length: 12 }, (_, index) =>
        playgroundHistoryMessage(
          childId,
          rootTurnId,
          `${childId}-older-${index + 1}`,
          index === 0 ? "Oldest loaded child message" : `Older child message ${index + 1}`,
          Date.now() - (120 - index * 3) * 1_000,
        ),
      ),
      nextCursor: null,
      availability: partial ? "partial" : "available",
      coverage: partial ? "partial" : "complete",
    };
  }
  return {
    messages: Array.from({ length: 18 }, (_, index) =>
      playgroundHistoryMessage(
        childId,
        rootTurnId,
        `${childId}-recent-${index + 1}`,
        index === 17 ? "Newest child message at the bottom of the transcript" : `Recent child message ${index + 1}`,
        Date.now() - (54 - index * 3) * 1_000,
      ),
    ),
    nextCursor: PLAYGROUND_HISTORY_CURSOR,
    availability: partial ? "partial" : "available",
    coverage: partial ? "partial" : "complete",
  };
}

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
      const messages = new Map(state.messages);
      messages.set(SESSION_ID, rootOnlyFeedMessages);
      const sessionStatus = new Map(state.sessionStatus);
      sessionStatus.set(SESSION_ID, "running");
      const toolResults = new Map(state.toolResults);
      toolResults.set(
        SESSION_ID,
        new Map([
          [
            "playground-root-settled",
            {
              tool_use_id: "playground-root-settled",
              content: "root command complete",
              is_error: false,
              total_size: 21,
              is_truncated: false,
              duration_seconds: 0.2,
            },
          ],
        ]),
      );
      const toolProgress = new Map(state.toolProgress);
      toolProgress.set(
        SESSION_ID,
        new Map([
          ["playground-root-live", { toolName: "Bash", elapsedSeconds: 14, output: "following root-agent.log" }],
        ]),
      );
      const toolStartTimestamps = new Map(state.toolStartTimestamps);
      toolStartTimestamps.set(
        SESSION_ID,
        new Map([
          ["playground-root-live", Date.now() - 14_000],
          ["playground-root-settled", Date.now() - 16_000],
        ]),
      );
      return { sessions, messages, sessionStatus, toolResults, toolProgress, toolStartTimestamps };
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
        const messages = new Map(state.messages);
        messages.delete(SESSION_ID);
        const sessionStatus = new Map(state.sessionStatus);
        sessionStatus.delete(SESSION_ID);
        const toolResults = new Map(state.toolResults);
        toolResults.delete(SESSION_ID);
        const toolProgress = new Map(state.toolProgress);
        toolProgress.delete(SESSION_ID);
        const toolStartTimestamps = new Map(state.toolStartTimestamps);
        toolStartTimestamps.delete(SESSION_ID);
        return { sessions, messages, sessionStatus, toolResults, toolProgress, toolStartTimestamps };
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
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card label="Root-only main feed — child activity stays in inspector">
          <div
            className="flex h-[360px] min-h-0 flex-col overflow-hidden border-t border-cc-border bg-cc-bg"
            data-testid="playground-codex-root-only-feed"
          >
            <MessageFeed sessionId={SESSION_ID} />
          </div>
        </Card>
        <Card label="Projection contract">
          <div className="space-y-2 border-t border-cc-border bg-cc-card p-4 text-xs leading-relaxed text-cc-muted">
            <p>Only root-owned assistant, reasoning, tool, error, and live-command activity appears in the feed.</p>
            <p>
              Use the retained subagent controls to inspect exact child messages, summaries, tools, results, and errors.
            </p>
          </div>
        </Card>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openInspector(SESSION_ID, { scopeTurnId: SETTLED_TURN })}
          className="min-h-10 rounded-lg border border-cc-border bg-cc-card px-4 text-xs font-medium text-cc-fg hover:bg-cc-hover"
        >
          Open many-child inspector list
        </button>
        <button
          type="button"
          onClick={() => openInspector(SESSION_ID, { selectedChildId: "csa-playground-2" })}
          className="min-h-10 rounded-lg border border-cc-border bg-cc-card px-4 text-xs font-medium text-cc-fg hover:bg-cc-hover"
        >
          Open paged partial transcript
        </button>
      </div>
      <CodexSubagentInspector sessionId={SESSION_ID} loadHistoryPage={loadPlaygroundHistory} />
    </Section>
  );
}
