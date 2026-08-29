// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { BrowserIncomingMessage, ChatMessage, ContentBlock, SessionState } from "../types.js";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { indexCodexSubagentToolResults } from "../utils/codex-subagent-tool-results.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { buildFeedMessageModel } from "../utils/feed-render-model.js";
import { buildCodexSubagentTranscriptModel, CodexSubagentTranscript } from "./CodexSubagentTranscript.js";

const ownership = { childId: "opaque-child", rootTurnId: "root-turn" };

function childMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    metadata: { ...message.metadata, codexSubagent: ownership },
  };
}

function installSession() {
  useStore.setState({
    sessions: new Map([
      [
        "session-1",
        {
          session_id: "session-1",
          backend_type: "codex",
          cwd: "/repo",
        } as SessionState,
      ],
    ]),
    toolResults: new Map(),
    toolProgress: new Map(),
    toolStartTimestamps: new Map(),
    streamingByParentToolUseId: new Map(),
    streamingThinkingByParentToolUseId: new Map(),
    backgroundAgentNotifs: new Map(),
    sessionStatus: new Map([["session-1", "idle"]]),
    sessionTasks: new Map(),
    changedFiles: new Map(),
    compactToolActivity: false,
  });
}

function rawAssistant(id: string, content: ContentBlock[], timestamp: number): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.6",
      content,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    codexSubagent: ownership,
  };
}

function producerHistoryBatch(): BrowserIncomingMessage[] {
  const longOutput = `long-output:${"x".repeat(420)}`;
  return [
    rawAssistant(
      "producer-child-answer",
      [{ type: "text", text: "Producer-shaped child answer stays in chronological audit." }],
      200,
    ),
    {
      type: "codex_reasoning_detail",
      id: "producer-reasoning-1",
      text: "**Inspecting schema**\nFirst verified summary.",
      status: "complete",
      timestamp: 201,
      parent_tool_use_id: "producer-read-tool",
      reasoning_turn_id: "producer-reasoning-turn",
      summary_index: 0,
      codexSubagent: ownership,
    },
    {
      type: "codex_reasoning_detail",
      id: "producer-reasoning-2",
      text: "**Checking result**\nSecond verified summary.",
      status: "complete",
      timestamp: 202,
      parent_tool_use_id: "producer-read-tool",
      reasoning_turn_id: "producer-reasoning-turn",
      summary_index: 1,
      codexSubagent: ownership,
    },
    rawAssistant(
      "producer-read-message",
      [
        { type: "tool_use", id: "producer-read-tool", name: "Read", input: { file_path: "src/example.ts" } },
        {
          type: "tool_result",
          tool_use_id: "producer-read-tool",
          content: "export const childResult = true;",
        },
      ],
      203,
    ),
    rawAssistant(
      "producer-bash-success",
      [
        { type: "tool_use", id: "producer-bash-1", name: "Bash", input: { command: "printf success" } },
        { type: "tool_result", tool_use_id: "producer-bash-1", content: longOutput },
      ],
      204,
    ),
    rawAssistant(
      "producer-bash-error",
      [
        { type: "tool_use", id: "producer-bash-2", name: "Bash", input: { command: "false" } },
        { type: "tool_result", tool_use_id: "producer-bash-2", content: "command failed", is_error: true },
      ],
      205,
    ),
    rawAssistant(
      "producer-no-result",
      [{ type: "tool_use", id: "producer-no-result-tool", name: "Glob", input: { pattern: "src/**/*.ts" } }],
      206,
    ),
  ];
}

function mainFeedHistoryBatch(): BrowserIncomingMessage[] {
  return producerHistoryBatch().flatMap<BrowserIncomingMessage>((message): BrowserIncomingMessage[] => {
    if (message.type !== "assistant") return [message];
    const toolResults = message.message.content.filter(
      (block): block is Extract<ContentBlock, { type: "tool_result" }> => block.type === "tool_result",
    );
    if (toolResults.length === 0) return [message];
    const assistant: BrowserIncomingMessage = {
      ...message,
      message: {
        ...message.message,
        content: message.message.content.filter((block) => block.type !== "tool_result"),
      },
    };
    return [
      assistant,
      {
        type: "tool_result_preview",
        previews: toolResults.map((block) => {
          const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          return {
            tool_use_id: block.tool_use_id,
            content,
            is_error: block.is_error === true,
            total_size: content.length,
            is_truncated: false,
          };
        }),
        codexSubagent: ownership,
      },
    ];
  });
}

function normalizedMainFeedHistory(): ChatMessage[] {
  const history = mainFeedHistoryBatch();
  const childResults = indexCodexSubagentToolResults(history).get(ownership.childId);
  return history.flatMap((message, index) =>
    normalizeHistoryMessageToChatMessages(message, index, {
      includeSuccessfulResult: true,
      fallbackTimestamp: 200,
      codexSubagentToolResults: childResults,
    }),
  );
}

function normalizedInspectorHistory(): ChatMessage[] {
  return producerHistoryBatch().flatMap((message, index) =>
    normalizeHistoryMessageToChatMessages(message, index, { includeSuccessfulResult: true, fallbackTimestamp: 200 }),
  );
}

function expectCanonicalProducerSurfaces(container: HTMLElement) {
  const scope = within(container);
  const answer = scope.getByText("Producer-shaped child answer stays in chronological audit.");
  const reasoning = scope.getByTestId("codex-reasoning-detail-group");
  const read = scope.getByRole("button", { name: /Read File.*src\/example\.ts/i });
  const bashGroup = scope.getByRole("button", { name: /Terminal.*2/i });

  expect(reasoning).toHaveTextContent("Checking result");
  expect(reasoning).toHaveTextContent("2 summaries");
  expect(answer.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reasoning.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(read.compareDocumentPosition(bashGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(read);
  fireEvent.click(scope.getByRole("button", { name: /printf success/i }));
  fireEvent.click(scope.getByRole("button", { name: /^false$/i }));
  expect(scope.getByText("export const childResult = true;")).toBeInTheDocument();
  expect(scope.getByText(/long-output:x{100}/)).toBeInTheDocument();
  expect(scope.getByText("command failed")).toBeInTheDocument();
  expect(scope.getByText("error")).toBeInTheDocument();

  return {
    reasoningClass: reasoning.className,
    readClass: read.className,
    bashGroupClass: bashGroup.className,
  };
}

const transcriptMessages: ChatMessage[] = [
  childMessage({
    id: "child-answer",
    role: "assistant",
    content: "Child answer in the canonical message surface.",
    contentBlocks: [{ type: "text", text: "Child answer in the canonical message surface." }],
    timestamp: 100,
  }),
  childMessage({
    id: "reasoning-1",
    role: "assistant",
    content: "**Inspecting schema**\nFirst verified summary.",
    timestamp: 101,
    parentToolUseId: "public-tool-id",
    metadata: {
      codexSubagent: ownership,
      codexReasoningDetail: { status: "complete", reasoningTurnId: "reasoning-turn" },
    },
  }),
  childMessage({
    id: "reasoning-2",
    role: "assistant",
    content: "**Checking result**\nSecond verified summary.",
    timestamp: 102,
    parentToolUseId: "public-tool-id",
    metadata: {
      codexSubagent: ownership,
      codexReasoningDetail: { status: "complete", reasoningTurnId: "reasoning-turn" },
    },
  }),
  childMessage({
    id: "read-tool-message",
    role: "assistant",
    content: "",
    contentBlocks: [
      { type: "tool_use", id: "public-tool-id", name: "Read", input: { file_path: "src/example.ts" } },
      {
        type: "tool_result",
        tool_use_id: "public-tool-id",
        content: "export const childResult = true;",
        is_error: false,
      },
    ],
    timestamp: 103,
  }),
];

describe("CodexSubagentTranscript", () => {
  beforeEach(installSession);

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("cc-edit-blocks-expanded");
    useStore.setState({ sessions: new Map(), toolResults: new Map() });
  });

  it("adapts self-contained history results without mutating the authoritative session store", () => {
    const model = buildCodexSubagentTranscriptModel(transcriptMessages);
    const toolMessage = model.messages.find((message) => message.id === "read-tool-message");
    const reasoning = model.messages.find((message) => message.id === "reasoning-1");

    expect(toolMessage?.contentBlocks).toEqual([
      { type: "tool_use", id: "public-tool-id", name: "Read", input: { file_path: "src/example.ts" } },
    ]);
    expect(model.toolResults.get("public-tool-id")).toMatchObject({
      content: "export const childResult = true;",
      is_error: false,
      is_truncated: false,
    });
    expect(reasoning?.parentToolUseId).toBeNull();
    expect(useStore.getState().toolResults.get("session-1")).toBeUndefined();
  });

  // Inspector history is self-contained: the server-projected preview must retain
  // its truncation contract without falling through to root-session result state.
  it("preserves server-projected bounded truncation metadata for the canonical result surface", () => {
    const truncatedMessages: ChatMessage[] = [
      childMessage({
        id: "truncated-read",
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "tool_use", id: "truncated-read-tool", name: "Read", input: { file_path: "src/example.ts" } },
          {
            type: "tool_result",
            tool_use_id: "truncated-read-tool",
            content: "export const childResult = true; // bounded tail",
            is_error: false,
            total_size: 8_192,
            is_truncated: true,
          },
        ],
        timestamp: 104,
      }),
    ];

    const model = buildCodexSubagentTranscriptModel(truncatedMessages);
    expect(model.toolResults.get("truncated-read-tool")).toMatchObject({
      total_size: 8_192,
      is_truncated: true,
    });

    render(<CodexSubagentTranscript sessionId="session-1" messages={truncatedMessages} />);
    fireEvent.click(screen.getByRole("button", { name: /Read File.*src\/example\.ts/i }));
    expect(screen.getByText("bounded preview · truncated")).toBeInTheDocument();
    expect(screen.getByText("output bytes: 8.0 KB")).toHaveAttribute(
      "title",
      "Original result size: 8,192 UTF-8 bytes",
    );
    expect(screen.getByText(/export const childResult = true; \/\/ bounded tail/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show full result" })).toBeNull();
  });

  it("reuses canonical message, reasoning-group, tool, and result surfaces", () => {
    render(<CodexSubagentTranscript sessionId="session-1" messages={transcriptMessages} />);

    const feed = screen.getByTestId("codex-subagent-transcript-feed");
    expect(within(feed).getByText("Child answer in the canonical message surface.")).toBeInTheDocument();

    const reasoningGroup = within(feed).getByTestId("codex-reasoning-detail-group");
    expect(reasoningGroup).toHaveTextContent("Checking result");
    expect(within(reasoningGroup).getByText("2 summaries")).toBeInTheDocument();

    const readTool = within(feed).getByRole("button", { name: /Read File.*src\/example\.ts/i });
    fireEvent.click(readTool);
    expect(within(feed).getByText("Result")).toBeInTheDocument();
    expect(within(feed).getByText("export const childResult = true;")).toBeInTheDocument();
    expect(useStore.getState().toolResults.get("session-1")).toBeUndefined();
  });

  it("keeps producer-shaped child history out of the root feed and canonical inside the inspector", () => {
    // The same authoritative child rows remain available to the inspector even
    // though the ordinary feed projection intentionally omits every owned row.
    const mainFeedMessages = normalizedMainFeedHistory();
    const inspectorMessages = normalizedInspectorHistory();
    const model = buildCodexSubagentTranscriptModel(inspectorMessages);
    const tasksBefore = useStore.getState().sessionTasks;
    const filesBefore = useStore.getState().changedFiles;
    const rootProjection = buildFeedMessageModel({
      leaderSessionId: "session-1",
      threadKey: "main",
      projectThreadRoutes: false,
      allMessages: mainFeedMessages,
      historyLoading: false,
      selectedFeedWindowEnabled: false,
      selectedFeedWindow: null,
      selectedFeedWindowMessages: [],
    });

    expect(rootProjection.messagesAvailableForDerivation).toHaveLength(mainFeedMessages.length);
    expect(rootProjection.messages).toEqual([]);

    const conflictingRootResults = new Map(model.toolResults);
    conflictingRootResults.set("producer-read-tool", {
      tool_use_id: "producer-read-tool",
      content: "ROOT RESULT COLLISION",
      is_error: true,
      total_size: 21,
      is_truncated: false,
    });
    conflictingRootResults.set("producer-no-result-tool", {
      tool_use_id: "producer-no-result-tool",
      content: "ROOT UNOWNED RESULT COLLISION",
      is_error: false,
      total_size: 29,
      is_truncated: false,
    });
    useStore.setState({ toolResults: new Map([["session-1", conflictingRootResults]]) });

    const child = render(<CodexSubagentTranscript sessionId="session-1" messages={inspectorMessages} />);
    expectCanonicalProducerSurfaces(child.container);
    expect(screen.queryByText("ROOT RESULT COLLISION")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Find Files.*src\/\*\*\/\*\.ts/i }));
    expect(screen.queryByText("ROOT UNOWNED RESULT COLLISION")).toBeNull();
    expect(screen.queryByRole("button", { name: "Message options" })).toBeNull();
    expect(useStore.getState().sessionTasks).toBe(tasksBefore);
    expect(useStore.getState().changedFiles).toBe(filesBefore);
  });

  it("keeps relative image and multi-file tools visual-only in the inspector", () => {
    localStorage.setItem("cc-edit-blocks-expanded", "false");
    const imageUrlSpy = vi.spyOn(api, "getFsImageUrl");
    const messages: ChatMessage[] = [
      childMessage({
        id: "private-file-link",
        role: "assistant",
        content: "[private artifact](file:artifacts/private.png)",
        contentBlocks: [{ type: "text", text: "[private artifact](file:artifacts/private.png)" }],
        timestamp: 299,
      }),
      childMessage({
        id: "private-image-read",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "tool_use",
            id: "private-image-read-tool",
            name: "Read",
            input: { file_path: "artifacts/private.png" },
          },
          {
            type: "tool_result",
            tool_use_id: "private-image-read-tool",
            content: "Binary image bytes hidden.",
          },
        ],
        timestamp: 300,
      }),
      childMessage({
        id: "private-image-bash",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "tool_use",
            id: "private-image-bash-tool",
            name: "Bash",
            input: { command: "cat artifacts/private.png" },
          },
          {
            type: "tool_result",
            tool_use_id: "private-image-bash-tool",
            content: "Bash image bytes hidden.",
          },
        ],
        timestamp: 301,
      }),
      childMessage({
        id: "private-multi-edit",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "tool_use",
            id: "private-multi-edit-tool",
            name: "Edit",
            input: {
              changes: [
                { path: "src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-oldA\n+newA" },
                { path: "src/b.ts", kind: "update", diff: "@@ -1 +1 @@\n-oldB\n+newB" },
              ],
            },
          },
        ],
        timestamp: 302,
      }),
    ];

    const { container } = render(<CodexSubagentTranscript sessionId="session-1" messages={messages} />);
    const read = screen.getByRole("button", { name: /Read File.*artifacts\/private\.png/i });
    const bash = screen.getByRole("button", { name: /^Readartifacts\/private\.png$/i });
    const edit = screen.getByRole("button", { name: /Edit File.*2 files/i });

    expect(screen.queryByRole("button", { name: "Open File" })).toBeNull();
    expect(screen.queryByRole("link", { name: "private artifact" })).toBeNull();
    expect(screen.getByText("private artifact")).toHaveAttribute("data-read-only-file-link", "true");
    fireEvent.click(read);
    fireEvent.click(bash);
    const editChevron = edit.querySelector("svg");
    if (!editChevron?.getAttribute("class")?.includes("rotate-90")) fireEvent.click(edit);

    expect(screen.getByText("Binary image bytes hidden.")).toBeInTheDocument();
    expect(screen.getByText("Bash image bytes hidden.")).toBeInTheDocument();
    expect(edit.querySelector("svg")?.getAttribute("class")).toContain("rotate-90");
    expect(screen.queryByRole("button", { name: "Open File" })).toBeNull();
    expect(screen.queryByText("image preview")).toBeNull();
    expect(container.querySelector('img[src*="/api/fs/image"]')).toBeNull();
    expect(imageUrlSpy).not.toHaveBeenCalled();
  });
});
