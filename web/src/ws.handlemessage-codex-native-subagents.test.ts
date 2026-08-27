// @vitest-environment jsdom

import type {
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatusCounts,
} from "../shared/codex-native-subagent-types.js";
import type { SessionState } from "./types.js";

vi.mock("./utils/names.js", () => ({ generateUniqueSessionName: vi.fn(() => "Native session") }));
vi.mock("./api.js", () => ({
  api: {
    getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
    listSessions: vi.fn().mockResolvedValue([]),
    getQuestTitles: vi.fn().mockResolvedValue({ quests: [], missingQuestIds: [] }),
  },
}));
vi.mock("./utils/notification-sound.js", () => ({ playNotificationSound: vi.fn() }));

let lastWs: MockWebSocket;
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    lastWs = this;
  }
}
vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;

beforeEach(async () => {
  vi.resetModules();
  const storeModule = await import("./store.js");
  useStore = storeModule.useStore;
  useStore.getState().reset();
  localStorage.clear();
  wsModule = await import("./ws.js");
});

function counts(overrides: Partial<CodexNativeSubagentStatusCounts> = {}): CodexNativeSubagentStatusCounts {
  return { starting: 0, working: 0, waiting: 0, done: 0, failed: 0, interrupted: 0, unknown: 0, ...overrides };
}

function snapshot(childId: string, revision: number): CodexNativeSubagentSnapshot {
  return {
    revision,
    coverage: "complete",
    session: { total: 1, statusCounts: counts({ done: 1 }), activeCount: 0, unresolvedCount: 0 },
    children: [
      {
        childId,
        rootTurnId: `turn-${childId}`,
        agentPath: `/root/${childId}`,
        displayName: childId,
        depth: 1,
        spawnOrder: 1,
        status: "done",
        statusObservedAt: 10,
        transcriptAvailability: "available",
      },
    ],
    turns: {
      [`turn-${childId}`]: {
        rootTurnId: `turn-${childId}`,
        total: 1,
        statusCounts: counts({ done: 1 }),
        status: "done",
        coverage: "complete",
      },
    },
  };
}

function session(id: string, native: CodexNativeSubagentSnapshot): SessionState {
  return {
    session_id: id,
    backend_type: "codex",
    model: "o4-mini",
    cwd: "/tmp",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/tmp",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    codex_native_subagents: native,
  };
}

function fire(message: unknown) {
  lastWs.onmessage?.({ data: JSON.stringify(message) });
}

describe("Codex native subagent browser authority", () => {
  it("replaces the whole nested snapshot on session_update instead of merging stale children or turns", () => {
    wsModule.connectSession("s1");
    fire({ type: "session_init", session: session("s1", snapshot("old-child", 1)) });
    fire({ type: "session_update", session: { codex_native_subagents: snapshot("new-child", 2) } });

    const native = useStore.getState().sessions.get("s1")?.codex_native_subagents;
    expect(native?.revision).toBe(2);
    expect(native?.children.map((child) => child.childId)).toEqual(["new-child"]);
    expect(native?.turns["turn-old-child"]).toBeUndefined();
  });

  it("keeps live child activity out of root streaming, task, progress, and lifecycle state", () => {
    wsModule.connectSession("s1");
    fire({ type: "session_init", session: session("s1", snapshot("safe-child", 1)) });

    const store = useStore.getState();
    store.setStreaming("s1", "root stream");
    store.setStreamingThinking("s1", "root reasoning");
    store.setSessionStatus("s1", "idle");
    store.setTasks("s1", [
      { id: "root-task", subject: "Keep root task", description: "Root-owned task", status: "pending" },
    ]);
    store.setToolProgress("s1", "root-tool", { toolName: "Bash", elapsedSeconds: 2 });

    const ownership = { childId: "safe-child", rootTurnId: "turn-safe-child" };
    fire({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "child stream" } },
      parent_tool_use_id: null,
      codexSubagent: ownership,
    });
    fire({
      type: "tool_progress",
      tool_use_id: "child-tool",
      tool_name: "Bash",
      elapsed_time_seconds: 3,
      output_delta: "child output",
      codexSubagent: ownership,
    });
    fire({
      type: "codex_reasoning_detail",
      id: "child-reasoning",
      text: "Official child summary",
      status: "streaming",
      timestamp: 11,
      parent_tool_use_id: null,
      codexSubagent: ownership,
    });
    fire({
      type: "assistant",
      message: {
        id: "child-live-message",
        type: "message",
        role: "assistant",
        model: "",
        content: [
          { type: "text", text: "Final child audit row" },
          {
            type: "tool_use",
            id: "child-todo",
            name: "TodoWrite",
            input: { todos: [{ content: "Must not replace root task", status: "pending", activeForm: "Testing" }] },
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 12,
      codexSubagent: ownership,
    });

    const next = useStore.getState();
    expect(next.streaming.get("s1")).toBe("root stream");
    expect(next.streamingThinking.get("s1")).toBe("root reasoning");
    expect(next.sessionStatus.get("s1")).toBe("idle");
    expect(next.sessionTasks.get("s1")).toEqual([
      { id: "root-task", subject: "Keep root task", description: "Root-owned task", status: "pending" },
    ]);
    expect(next.toolProgress.get("s1")?.has("child-tool")).toBe(false);
    expect(next.toolProgress.get("s1")?.has("root-tool")).toBe(true);
    expect(
      next.messages.get("s1")?.find((message) => message.id === "child-live-message")?.metadata?.codexSubagent,
    ).toEqual(ownership);
    expect(
      next.messages.get("s1")?.find((message) => message.id === "child-reasoning")?.metadata?.codexSubagent,
    ).toEqual(ownership);
  });

  it("preserves child audit rows without letting authoritative replay replace root-derived state", () => {
    wsModule.connectSession("s1");
    fire({ type: "session_init", session: session("s1", snapshot("safe-child", 1)) });
    const ownership = { childId: "safe-child", rootTurnId: "turn-safe-child" };
    useStore.getState().addPendingUserUpload("s1", {
      id: "colliding-upload",
      content: "Root image upload",
      timestamp: 1,
      stage: "delivering",
      images: [
        {
          id: "root-local-image",
          name: "root-private.png",
          base64: "root-private-image-data",
          mediaType: "image/png",
          status: "ready",
        },
      ],
    });
    fire({
      type: "message_history",
      messages: [
        { type: "user_message", id: "root-user", content: "Root preview", timestamp: 1 },
        {
          type: "assistant",
          message: {
            id: "root-message",
            type: "message",
            role: "assistant",
            model: "",
            content: [
              {
                type: "tool_use",
                id: "root-todo",
                name: "TodoWrite",
                input: { todos: [{ content: "Keep root task", status: "in_progress", activeForm: "Root work" }] },
              },
              { type: "tool_use", id: "root-write", name: "Write", input: { file_path: "/tmp/root.ts" } },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 2,
          tool_start_times: { "root-todo": 100 },
        },
        {
          type: "assistant",
          message: {
            id: "child-message",
            type: "message",
            role: "assistant",
            model: "",
            content: [
              { type: "text", text: "child text" },
              {
                type: "tool_use",
                id: "child-todo",
                name: "TodoWrite",
                input: { todos: [{ content: "Must not replace root task", status: "pending" }] },
              },
              { type: "tool_use", id: "child-write", name: "Write", input: { file_path: "/tmp/child.ts" } },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 3,
          tool_start_times: { "child-todo": 200 },
          codexSubagent: ownership,
        },
        {
          type: "user_message",
          id: "child-user",
          content: "Must not replace root preview",
          timestamp: 4,
          client_msg_id: "colliding-upload",
          codexSubagent: ownership,
        },
      ],
    });

    const state = useStore.getState();
    expect(
      state.messages.get("s1")?.find((message) => message.id === "child-message")?.metadata?.codexSubagent,
    ).toEqual(ownership);
    expect(state.sessionTasks.get("s1")).toEqual([
      {
        id: "1",
        subject: "Keep root task",
        description: "",
        activeForm: "Root work",
        status: "in_progress",
      },
    ]);
    expect(state.sessionTaskPreview.get("s1")).toMatchObject({ text: "Root work" });
    expect(state.toolStartTimestamps.get("s1")).toEqual(new Map([["root-todo", 100]]));
    expect(state.changedFiles.get("s1")).toEqual(new Set(["/tmp/root.ts"]));
    expect(state.sessionPreviews.get("s1")).toBe("Root preview");
    const childUser = state.messages.get("s1")?.find((message) => message.id === "child-user");
    expect(childUser?.clientMsgId).toBe("colliding-upload");
    expect(childUser?.localImages).toBeUndefined();
    expect(state.pendingUserUploads.get("s1")?.map((upload) => upload.id)).toEqual(["colliding-upload"]);
  });

  it("keeps selected-thread child rows from mutating root tasks, files, or tool timing", () => {
    wsModule.connectSession("s1");
    fire({ type: "session_init", session: session("s1", snapshot("safe-child", 1)) });
    const ownership = { childId: "safe-child", rootTurnId: "turn-safe-child" };
    const assistant = (
      id: string,
      content: Array<Record<string, unknown>>,
      toolStartTimes: Record<string, number>,
      codexSubagent?: typeof ownership,
    ) => ({
      history_index: id === "root-thread-message" ? 10 : 11,
      message: {
        type: "assistant",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: "",
          content,
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 10,
        tool_start_times: toolStartTimes,
        ...(codexSubagent ? { codexSubagent } : {}),
      },
    });

    fire({
      type: "thread_window_sync",
      thread_key: "main",
      entries: [
        assistant(
          "root-thread-message",
          [
            {
              type: "tool_use",
              id: "root-thread-todo",
              name: "TodoWrite",
              input: { todos: [{ content: "Thread root task", status: "pending" }] },
            },
            {
              type: "tool_use",
              id: "root-thread-write",
              name: "Write",
              input: { file_path: "/tmp/thread-root.ts" },
            },
          ],
          { "root-thread-todo": 300 },
        ),
        assistant(
          "child-thread-message",
          [
            {
              type: "tool_use",
              id: "child-thread-todo",
              name: "TodoWrite",
              input: { todos: [{ content: "Child thread task", status: "in_progress" }] },
            },
            {
              type: "tool_use",
              id: "child-thread-write",
              name: "Write",
              input: { file_path: "/tmp/thread-child.ts" },
            },
          ],
          { "child-thread-todo": 400 },
          ownership,
        ),
      ],
      window: {
        thread_key: "main",
        from_item: 0,
        item_count: 2,
        total_items: 2,
        source_history_length: 2,
        section_item_count: 10,
        visible_item_count: 2,
      },
    });

    const state = useStore.getState();
    expect(state.sessionTasks.get("s1")?.map((task) => task.subject)).toEqual(["Thread root task"]);
    expect(state.toolStartTimestamps.get("s1")).toEqual(new Map([["root-thread-todo", 300]]));
    expect(state.changedFiles.get("s1")).toEqual(new Set(["/tmp/thread-root.ts"]));
    expect(
      state.threadWindowMessages
        .get("s1")
        ?.get("main")
        ?.find((message) => message.id === "child-thread-message")?.metadata?.codexSubagent,
    ).toEqual(ownership);
  });
});
