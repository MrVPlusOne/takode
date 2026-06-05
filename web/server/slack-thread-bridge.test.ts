import { describe, expect, it, vi } from "vitest";
import { routeSlackThreadUserMessage } from "./slack-thread-bridge.js";
import type { BrowserIncomingMessage, SlackThreadRecord, SessionState } from "./session-types.js";

vi.mock("./bridge/adapter-browser-routing-controller.js", () => ({
  routeBrowserMessage: vi.fn(async () => {}),
}));

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: "s",
    model: "test",
    cwd: "/repo",
    tools: [],
    permissionMode: "default",
    claude_code_version: "test",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 1,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/repo",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...overrides,
  };
}

function user(id: string, content: string): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp: 1 };
}

function assistant(id: string, text: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1,
    uuid: id,
  };
}

function makeRecord(overrides: Partial<SlackThreadRecord> = {}): SlackThreadRecord {
  return {
    id: "st-1",
    rootSessionId: "root",
    childSessionId: "child",
    anchorMessageId: "a1",
    anchorHistoryIndex: 1,
    anchorPreview: "Anchor",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    seeded: false,
    ...overrides,
  };
}

describe("Slack thread bridge", () => {
  it("sends bounded replay diagnostics only for fallback thread context", async () => {
    const { routeBrowserMessage } = await import("./bridge/adapter-browser-routing-controller.js");
    vi.mocked(routeBrowserMessage).mockClear();
    const record = makeRecord({
      contextStrategy: "bounded-replay",
      contextFallbackReason: "Codex native fork skipped: anchor is not the final assistant message in its Codex turn",
    });
    const root = {
      id: "root",
      state: makeState({ session_id: "root", slackThreads: { "st-1": record } }),
      messageHistory: [user("u1", "Root prompt"), assistant("a1", "Root answer")],
    };
    const child = {
      id: "child",
      state: makeState({
        session_id: "child",
        slackThreadChild: {
          rootSessionId: "root",
          threadId: "st-1",
          anchorMessageId: "a1",
          anchorHistoryIndex: 1,
          readOnly: true,
        },
      }),
      messageHistory: [],
    };

    await routeSlackThreadUserMessage(
      {
        sessions: new Map([
          ["root", root as never],
          ["child", child as never],
        ]),
        getBrowserRoutingDeps: () => ({}) as never,
        broadcastToBrowsers: vi.fn(),
        persistSession: vi.fn(),
      },
      "root",
      "st-1",
      "Thread question",
    );

    const routed = vi.mocked(routeBrowserMessage).mock.calls[0][1] as { deliveryContent?: string };
    expect(routed.deliveryContent).toContain("Native backend fork was unavailable");
    expect(routed.deliveryContent).toContain("Root branch context:");
    expect(routed.deliveryContent).toContain("Thread question");
  });

  it("does not replay root transcript for already native-forked threads", async () => {
    const { routeBrowserMessage } = await import("./bridge/adapter-browser-routing-controller.js");
    vi.mocked(routeBrowserMessage).mockClear();
    const record = makeRecord({ seeded: true, contextStrategy: "native-fork" });
    const root = {
      id: "root",
      state: makeState({ session_id: "root", slackThreads: { "st-1": record } }),
      messageHistory: [user("u1", "Root prompt"), assistant("a1", "Root answer")],
    };
    const child = {
      id: "child",
      state: makeState({
        session_id: "child",
        slackThreadChild: {
          rootSessionId: "root",
          threadId: "st-1",
          anchorMessageId: "a1",
          anchorHistoryIndex: 1,
          readOnly: true,
        },
      }),
      messageHistory: [],
    };

    await routeSlackThreadUserMessage(
      {
        sessions: new Map([
          ["root", root as never],
          ["child", child as never],
        ]),
        getBrowserRoutingDeps: () => ({}) as never,
        broadcastToBrowsers: vi.fn(),
        persistSession: vi.fn(),
      },
      "root",
      "st-1",
      "Thread question",
    );

    const routed = vi.mocked(routeBrowserMessage).mock.calls[0][1] as { deliveryContent?: string };
    expect(routed.deliveryContent).toBeUndefined();
  });
});
