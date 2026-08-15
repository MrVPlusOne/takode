import { useState } from "react";
import type { ToolMsgGroup } from "../../hooks/use-feed-model.js";
import type { ChatMessage } from "../../types.js";
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
      description="Small groups stay descriptive; large or growing Bash/MCP groups use stable invocation counts with lossless expansion."
    >
      <div className="space-y-4 max-w-3xl">
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
