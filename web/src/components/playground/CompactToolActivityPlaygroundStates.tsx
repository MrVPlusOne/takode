import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../store.js";
import { groupMessages, type ToolMsgGroup } from "../../hooks/use-feed-model.js";
import { NODE_REPL_TOOL_MESSAGES, NODE_REPL_TOOL_RESULTS } from "../../test-fixtures/node-repl-tools.js";
import type { ChatMessage, ToolResultPreview } from "../../types.js";
import { CompactFeedActivity } from "../CompactFeedActivity.js";
import { CompactToolMessageGroups } from "../ToolMessageGroup.js";
import { MOCK_SESSION_ID } from "./fixtures.js";
import { Card, Section } from "./shared.js";

function makeBashGroup(count: number, prefix: string): ToolMsgGroup {
  return {
    kind: "tool_msg_group",
    toolName: "Bash",
    firstId: `${prefix}-message`,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-bash-${index + 1}`,
      name: "Bash",
      input: { command: `echo tool-call-${index + 1}` },
      messageId: `${prefix}-message`,
    })),
  };
}

// Claude Bash calls carry a short description; a lone call shows its own chip.
const SINGLE_DESCRIBED_COMMAND_GROUPS: ToolMsgGroup[] = [
  "Inspect SDK v2 session stream and resume",
  "Look at v2 session stream and constructor",
].map((description, index) => ({
  kind: "tool_msg_group",
  toolName: "Bash",
  firstId: `compact-single-command-${index + 1}`,
  items: [
    {
      id: `compact-single-command-bash-${index + 1}`,
      name: "Bash",
      input: { command: `rg -n "session stream" sdk.mjs | head -${index + 3}`, description },
      messageId: `compact-single-command-${index + 1}`,
    },
  ],
}));

const SMALL_MCP_GROUP: ToolMsgGroup = {
  kind: "tool_msg_group",
  toolName: "mcp:slack:search",
  firstId: "compact-small-mcp",
  mixedToolNames: true,
  items: [
    { id: "compact-small-search", name: "mcp:slack:search", input: { query: "handoff" } },
    { id: "compact-small-thread", name: "mcp:slack:thread", input: { thread_ts: "123.456" } },
  ],
};

const NODE_REPL_GROUPS = groupMessages(NODE_REPL_TOOL_MESSAGES).filter((entry) => entry.kind === "tool_msg_group");

// Claude assistant messages that each carry an empty thinking block plus one
// command, as Opus sends them; the empty blocks must not split the run.
const CLAUDE_EMPTY_THINKING_GROUPS = groupMessages(
  ["Inspect SDK v2 session stream", "Look at v2 session constructor", "Find origin of replay-gated flush"].map(
    (description, index): ChatMessage => ({
      id: `claude-empty-thinking-${index + 1}`,
      role: "assistant",
      content: "",
      timestamp: Date.now() - (3 - index) * 1_000,
      contentBlocks: [
        { type: "thinking", thinking: "" },
        {
          type: "tool_use",
          id: `claude-empty-thinking-bash-${index + 1}`,
          name: "Bash",
          input: { command: `rg -n "stream" sdk.mjs | head -${index + 3}`, description },
        },
      ],
    }),
  ),
).filter((entry) => entry.kind === "tool_msg_group");

const LARGE_MIXED_GROUP: ToolMsgGroup = {
  kind: "tool_msg_group",
  toolName: "Bash",
  firstId: "compact-large-mixed",
  mixedToolNames: true,
  items: Array.from({ length: 71 }, (_, index) =>
    index % 3 === 0
      ? {
          id: `compact-large-bash-${index + 1}`,
          name: "Bash",
          input: { command: `printf 'batch ${index + 1}\\n'` },
        }
      : {
          id: `compact-large-mcp-${index + 1}`,
          name: `mcp:slack:${index % 2 === 0 ? "search_messages" : "get_thread"}`,
          input: { query: `historical evidence ${index + 1}` },
        },
  ),
};

const PURE_WORKER_SEND_GROUP: ToolMsgGroup = {
  kind: "tool_msg_group",
  toolName: "Bash",
  firstId: "compact-pure-worker-send",
  items: [
    {
      id: "compact-pure-worker-send-1",
      name: "Bash",
      input: { command: 'takode send 17 "Please continue with the focused checks"' },
      messageId: "compact-pure-worker-send",
    },
  ],
};

// The needs-input decision renders as its own card on the anchored prose, so
// the command that raised it is an ordinary line with no extra chip.
const NEEDS_INPUT_NOTIFY_GROUP: ToolMsgGroup = {
  kind: "tool_msg_group",
  toolName: "Bash",
  firstId: "compact-needs-input-notify",
  items: [
    {
      id: "compact-needs-input-notify-1",
      name: "Bash",
      input: {
        command: 'takode notify needs-input "Choose how to move the note" --body-file -',
        description: "Ask the user how to handle the note",
      },
      messageId: "compact-needs-input-notify",
    },
    {
      id: "compact-needs-input-notify-2",
      name: "Bash",
      input: {
        command: "takode board set q-1 --wait-for-input 110",
        description: "Link the question to the board row",
      },
      messageId: "compact-needs-input-notify",
    },
  ],
};

const MIXED_WORKER_SEND_GROUP: ToolMsgGroup = {
  kind: "tool_msg_group",
  toolName: "Bash",
  firstId: "compact-worker-send",
  items: [
    {
      id: "compact-worker-send-1",
      name: "Bash",
      input: { command: 'takode send 17 "Please continue with the focused checks"' },
      messageId: "compact-worker-send",
    },
    {
      id: "compact-worker-send-command",
      name: "Bash",
      input: { command: "git status --short" },
      messageId: "compact-worker-send",
    },
  ],
};

const WORKER_EVENTS: ChatMessage[] = [
  {
    id: "compact-tool-worker-1",
    role: "user",
    content: "1 event from 1 session\n\n#2485 | turn_end | ok 12s | tools: 7",
    timestamp: Date.now() - 2_000,
    takodeHerdEvents: [
      { event: "turn_end", sessionId: "worker-2485", sessionNum: 2485, routine: true, ts: Date.now() - 2_000 },
    ],
  },
  {
    id: "compact-tool-worker-2",
    role: "user",
    content: "1 event from 1 session\n\n#2486 | session_error | interrupted | tools: 3",
    timestamp: Date.now() - 1_000,
    takodeHerdEvents: [
      { event: "session_error", sessionId: "worker-2486", sessionNum: 2486, routine: false, ts: Date.now() - 1_000 },
    ],
  },
];

// ─── Activity groups: only agent text splits them ───────────────────────────

const ACTIVITY_SESSION_ID = "playground-activity-groups";
const LIVE_ACTIVITY_SESSION_ID = "playground-activity-live";

// Producer-shaped: history normalization copies thinking text into `content`.
const ACTIVITY_THOUGHT: ChatMessage = {
  id: "activity-thought",
  role: "assistant",
  content: "**Check where the preview falls back**\nThe 60-character cap makes long descriptions show the command.",
  timestamp: Date.now() - 60_000,
  contentBlocks: [
    {
      type: "thinking",
      thinking:
        "**Check where the preview falls back**\nThe 60-character cap makes long descriptions show the command.",
    },
  ],
};

// A realistic mixed run between two pieces of agent text: read, search, edit and test.
const ACTIVITY_TOOLS: Array<{ id: string; name: string; input: Record<string, unknown> }> = [
  { id: "activity-read", name: "Read", input: { file_path: "web/src/components/ToolBlock.tsx" } },
  { id: "activity-grep", name: "Grep", input: { pattern: "getPreview(", path: "web/src" } },
  {
    id: "activity-callers",
    name: "Bash",
    input: { command: "rg -n 'getPreview(' src", description: "Find getPreview callers" },
  },
  { id: "activity-edit-1", name: "Edit", input: { file_path: "web/src/components/ToolBlock.tsx" } },
  { id: "activity-edit-2", name: "Edit", input: { file_path: "web/src/components/ToolBlock.bash-preview.test.tsx" } },
  {
    id: "activity-test-1",
    name: "Bash",
    input: {
      command: "bun --no-install x vitest run src/components/ToolBlock",
      description: "Run focused ToolBlock tests",
    },
  },
  { id: "activity-edit-3", name: "Edit", input: { file_path: "web/src/components/ToolBlock.bash-preview.test.tsx" } },
  {
    id: "activity-test-2",
    name: "Bash",
    input: {
      command: "bun --no-install x vitest run src/components/ToolBlock",
      description: "Run focused ToolBlock tests",
    },
  },
  {
    id: "activity-commit",
    name: "Bash",
    input: { command: "git commit -m 'fix(feed): prefer descriptions'", description: "Commit the description fix" },
  },
];

function toolGroup(id: string, tools: typeof ACTIVITY_TOOLS): ToolMsgGroup {
  return {
    kind: "tool_msg_group",
    toolName: tools[0]?.name ?? "Bash",
    firstId: id,
    mixedToolNames: tools.some((tool) => tool.name !== tools[0]?.name),
    items: tools.map((tool) => ({ ...tool, messageId: id })),
  };
}

function activityResult(id: string, durationSeconds: number, isError = false): ToolResultPreview {
  return {
    tool_use_id: id,
    content: isError ? "FAIL  ToolBlock Bash previews > prefers a long description" : "ok",
    is_error: isError,
    total_size: 2,
    is_truncated: false,
    duration_seconds: durationSeconds,
  };
}

const ACTIVITY_SEGMENTS = [
  { kind: "thought" as const, messages: [ACTIVITY_THOUGHT] },
  { kind: "tool" as const, groups: [toolGroup("activity-tools", ACTIVITY_TOOLS)] },
];

const SINGLE_ACTIVITY_GROUP = toolGroup("activity-single", [
  {
    id: "activity-single-bash",
    name: "Bash",
    input: {
      command: "quest feedback add q-1 --kind comment --text 'User Checkpoint decision'",
      description: "Record the decision, resume Work, and instruct the worker",
    },
  },
]);

const NO_IDS: string[] = [];

// Line previews that used to say nothing: a skill call ("Skill Skill"), absolute
// worktree paths cut off before the file name, a multi-file Codex edit and a Claude MCP name.
const WORKTREE = "/Users/me/.companion/worktrees/companion/wt-1019";
const PREVIEW_LINES_GROUP = toolGroup("activity-preview-lines", [
  { id: "preview-skill", name: "Skill", input: { skill: "quest" } },
  {
    id: "preview-edit",
    name: "Edit",
    input: { file_path: `${WORKTREE}/web/src/components/ThreadReplyChip.tsx`, old_string: "a", new_string: "b" },
  },
  {
    id: "preview-patch",
    name: "Edit",
    input: {
      file_path: `${WORKTREE}/web/src/components/CompactToolActivity.tsx`,
      changes: [
        { path: `${WORKTREE}/web/src/components/CompactToolActivity.tsx`, kind: "update" },
        { path: `${WORKTREE}/web/src/components/CompactToolActivity.test.tsx`, kind: "update" },
      ],
    },
  },
  { id: "preview-mcp", name: "mcp__slack__slack_get_thread", input: { channel_id: "C0123", thread_ts: "1.2" } },
]);

/** Seed this fixture's own session results so lines show failed and finished states. */
// Pass stable arrays: the effect re-seeds whenever they change identity.
function useSeededActivityResults(sessionId: string, results: ToolResultPreview[], runningIds: string[] = NO_IDS) {
  useEffect(() => {
    useStore.setState((state) => ({
      toolResults: new Map(state.toolResults).set(sessionId, new Map(results.map((r) => [r.tool_use_id, r]))),
      toolStartTimestamps: new Map(state.toolStartTimestamps).set(
        sessionId,
        new Map(runningIds.map((id) => [id, Date.now() - 4_000])),
      ),
    }));
  }, [sessionId, results, runningIds]);
}

const ACTIVITY_RESULTS = ACTIVITY_TOOLS.map((tool, index) =>
  activityResult(tool.id, tool.name === "Bash" ? 3.8 : 0.1, index === 5),
);

function AgentText({ children }: { children: string }) {
  return <p className="text-[14px] leading-relaxed text-cc-fg">{children}</p>;
}

function PlaygroundActivityConversation() {
  useSeededActivityResults(ACTIVITY_SESSION_ID, ACTIVITY_RESULTS);
  return (
    <div className="space-y-2" data-testid="playground-activity-conversation">
      <AgentText>
        The collapsed header falls back to the raw command for long descriptions. Fixing that first.
      </AgentText>
      <CompactFeedActivity
        segments={ACTIVITY_SEGMENTS}
        sessionId={ACTIVITY_SESSION_ID}
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
        active={false}
      />
      <AgentText>Fixed and committed. Now recording the decision.</AgentText>
      <CompactToolMessageGroups
        groups={[SINGLE_ACTIVITY_GROUP]}
        sessionId={ACTIVITY_SESSION_ID}
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />
      <AgentText>Recorded. The worker is resuming Work.</AgentText>
    </div>
  );
}

function PlaygroundExpandedActivityGroup() {
  useSeededActivityResults(ACTIVITY_SESSION_ID, ACTIVITY_RESULTS);
  return (
    <div data-testid="playground-activity-expanded">
      <CompactFeedActivity
        segments={ACTIVITY_SEGMENTS}
        sessionId={ACTIVITY_SESSION_ID}
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
        defaultExpanded
      />
    </div>
  );
}

/** A live group: the newest activity is running, and adding one rolls the oldest into "+N earlier". */
function PlaygroundLiveActivityGroup() {
  const [count, setCount] = useState(5);
  const tools = useMemo(() => ACTIVITY_TOOLS.slice(0, count), [count]);
  const results = useMemo(() => ACTIVITY_RESULTS.slice(0, count - 1), [count]);
  const runningIds = useMemo(() => [ACTIVITY_TOOLS[count - 1].id], [count]);
  useSeededActivityResults(LIVE_ACTIVITY_SESSION_ID, results, runningIds);
  return (
    <div className="space-y-3" data-testid="playground-activity-live">
      <AgentText>Fixing that first.</AgentText>
      <CompactFeedActivity
        segments={[
          { kind: "thought", messages: [ACTIVITY_THOUGHT] },
          { kind: "tool", groups: [toolGroup("activity-live-tools", tools)] },
        ]}
        sessionId={LIVE_ACTIVITY_SESSION_ID}
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />
      <button
        type="button"
        disabled={count >= ACTIVITY_TOOLS.length}
        onClick={() => setCount((current) => current + 1)}
        className="rounded-md border border-cc-border px-2.5 py-1 text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg disabled:opacity-50"
      >
        Next activity arrives
      </button>
    </div>
  );
}

function PlaygroundGrowingToolActivity() {
  const [count, setCount] = useState(7);
  return (
    <div className="space-y-3 border-t border-cc-border bg-cc-card px-4 py-3">
      <CompactToolMessageGroups
        groups={[makeBashGroup(count, "compact-growing")]}
        sessionId={MOCK_SESSION_ID}
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
      />
      <button
        type="button"
        onClick={() => setCount((current) => current + 1)}
        className="rounded-md border border-cc-border px-2.5 py-1 text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
      >
        Add tool call
      </button>
    </div>
  );
}

export function PlaygroundCompactToolActivityStates() {
  return (
    <Section
      title="Compact Tool Activity"
      description="Only agent text splits activity: tools of any type, thoughts and routine worker events between two pieces of text form one group. A lone activity is one light line; a group is a card with a summary heading. While the group is active (nothing has followed it yet), the heading sits over a rolling window of its newest three activities, older ones folded into +N earlier; once later content follows, the collapsed group shows only its heading. Expanding fills older lines in place, and every line opens to its own details."
    >
      <div className="space-y-4 max-w-3xl">
        <Card label="Conversation: agent text alternates with inactive activity groups (collapsed to headings)">
          <PlaygroundActivityConversation />
        </Card>
        <Card label="Group expanded: older lines fill in above">
          <PlaygroundExpandedActivityGroup />
        </Card>
        <Card label="Live group: active, rolling window of the newest three, newest activity running">
          <PlaygroundLiveActivityGroup />
        </Card>
        <Card label="Line previews: skill names, long paths cut like diff headers, multi-file edits, MCP names">
          <div data-testid="playground-activity-preview-lines">
            <CompactFeedActivity
              segments={[{ kind: "tool", groups: [PREVIEW_LINES_GROUP] }]}
              sessionId={MOCK_SESSION_ID}
              isCodexSession={false}
              activeCodexTerminalIds={new Set()}
              onOpenCodexTerminal={() => {}}
              defaultExpanded
            />
          </div>
        </Card>
        <Card label="Single described commands (light lines that open straight to details)">
          <div className="space-y-2" data-testid="playground-single-command-chips">
            {SINGLE_DESCRIBED_COMMAND_GROUPS.map((group) => (
              <CompactToolMessageGroups
                key={group.firstId}
                groups={[group]}
                sessionId={MOCK_SESSION_ID}
                isCodexSession={false}
                activeCodexTerminalIds={new Set()}
                onOpenCodexTerminal={() => {}}
              />
            ))}
          </div>
        </Card>
        <Card label="Claude commands with empty thinking blocks (one group)">
          <div data-testid="playground-claude-empty-thinking-group">
            <CompactToolMessageGroups
              groups={CLAUDE_EMPTY_THINKING_GROUPS}
              sessionId={MOCK_SESSION_ID}
              isCodexSession={false}
              activeCodexTerminalIds={new Set()}
              onOpenCodexTerminal={() => {}}
            />
          </div>
        </Card>
        <Card label="Node REPL titles and fallback">
          <div data-testid="playground-node-repl-titles">
            <CompactToolMessageGroups
              groups={NODE_REPL_GROUPS}
              sessionId={MOCK_SESSION_ID}
              isCodexSession
              activeCodexTerminalIds={new Set()}
              onOpenCodexTerminal={() => {}}
              interactionMode="read-only"
              toolResultOverrides={NODE_REPL_TOOL_RESULTS}
              toolResultScope="overrides-only"
            />
          </div>
        </Card>
        <Card label="Small descriptive MCP group">
          <CompactToolMessageGroups
            groups={[SMALL_MCP_GROUP]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Large mixed Bash/MCP group (71 tool calls)">
          <CompactToolMessageGroups
            groups={[LARGE_MIXED_GROUP]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Active growing group">
          <PlaygroundGrowingToolActivity />
        </Card>
        <Card label="Worker message">
          <CompactToolMessageGroups
            groups={[PURE_WORKER_SEND_GROUP]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Needs-input notify command (ordinary lines; the decision card lives on its anchor)">
          <CompactToolMessageGroups
            groups={[NEEDS_INPUT_NOTIFY_GROUP]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Worker message plus ordinary command">
          <CompactToolMessageGroups
            groups={[MIXED_WORKER_SEND_GROUP]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
        <Card label="Large tool group with worker events">
          <CompactFeedActivity
            segments={[
              { kind: "tool", groups: [makeBashGroup(7, "compact-mixed-worker")] },
              { kind: "worker_event", messages: WORKER_EVENTS },
            ]}
            sessionId={MOCK_SESSION_ID}
            isCodexSession={false}
            activeCodexTerminalIds={new Set()}
            onOpenCodexTerminal={() => {}}
          />
        </Card>
      </div>
    </Section>
  );
}
