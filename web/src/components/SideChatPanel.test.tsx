// @vitest-environment jsdom
import "@testing-library/jest-dom";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatMessage, PendingCodexInput, PermissionRequest, SessionState, SideChatRecord } from "../types.js";

const sendSideChatMessageMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const connectSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly body: unknown,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  api: {
    sendSideChatMessage: sendSideChatMessageMock,
  },
}));

vi.mock("../ws.js", () => ({
  connectSession: connectSessionMock,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { useStore } from "../store.js";
import { SideChatPanel } from "./SideChatPanel.js";

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "thread-assistant",
    role: "assistant",
    content: "Side Chat answer",
    timestamp: 100,
    ...overrides,
  };
}

function makeSideChat(overrides: Partial<SideChatRecord> = {}): SideChatRecord {
  return {
    id: "st-1",
    rootSessionId: "root",
    childSessionId: "hidden-child",
    anchorMessageId: "root-assistant",
    anchorHistoryIndex: 1,
    anchorPreview: "Root answer",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    seeded: true,
    ...overrides,
  };
}

function makeSession(sessionId: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: sessionId,
    backend_type: "codex",
    model: "gpt-5.5",
    cwd: "/tmp/test",
    tools: [],
    permissionMode: "default",
    claude_code_version: "1",
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
    repo_root: "/tmp/test",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...overrides,
  };
}

function seedRootAndChild({
  root,
  child,
  childConnected = true,
  childEverConnected = true,
  childConnectionStatus = "connected",
}: {
  root?: Partial<SessionState>;
  child?: Partial<SessionState>;
  childConnected?: boolean;
  childEverConnected?: boolean;
  childConnectionStatus?: "connecting" | "connected" | "disconnected";
} = {}) {
  const store = useStore.getState();
  store.addSession(makeSession("root", { slackThreads: { "st-1": makeSideChat() }, ...root }));
  store.addSession(
    makeSession("hidden-child", {
      hidden: true,
      slackThreadChild: {
        rootSessionId: "root",
        threadId: "st-1",
        anchorMessageId: "root-assistant",
        anchorHistoryIndex: 1,
        readOnly: true,
      },
      ...child,
    }),
  );
  store.setConnectionStatus("hidden-child", childConnectionStatus);
  if (childConnected) {
    store.setCliConnected("hidden-child", true);
  } else {
    store.setCliConnected("hidden-child", false);
    if (childEverConnected) store.setCliEverConnected("hidden-child");
  }
}

function makePermission(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: "perm-1",
    tool_name: "Edit",
    tool_use_id: "tool-1",
    input: { file_path: "/tmp/test.ts" },
    timestamp: 123,
    ...overrides,
  };
}

function makePendingInput(overrides: Partial<PendingCodexInput> = {}): PendingCodexInput {
  return {
    id: "pending-1",
    content: "Queued Side Chat message",
    timestamp: Date.now(),
    cancelable: true,
    ...overrides,
  };
}

describe("SideChatPanel", () => {
  beforeEach(() => {
    useStore.getState().reset();
    sendSideChatMessageMock.mockClear();
    connectSessionMock.mockClear();
  });

  it("renders Side Chat assistant messages without nested Side Chat creation affordances", () => {
    useStore.setState({
      messages: new Map([["hidden-child", [makeAssistantMessage()]]]),
    });

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    expect(screen.getByText("Side Chat answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Side Chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Side Chat with/i })).toBeNull();
  });

  it("explains that Side Chat replies are read-only and must not edit files", () => {
    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    expect(screen.getByText(/Use this workspace for analysis and follow-up questions only/i)).toBeTruthy();
    expect(screen.getByText(/File and repo edits are blocked here/i)).toBeTruthy();
  });

  it("shows bounded replay provenance and fallback reason", () => {
    render(
      <SideChatPanel
        rootSessionId="root"
        sideChat={makeSideChat({
          contextStrategy: "bounded-replay",
          contextFallbackReason: "Codex native fork skipped: anchor turn is not complete",
        })}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Bounded replay")).toBeTruthy();
    expect(screen.getByText(/Native fork was unavailable/i)).toBeTruthy();
    expect(screen.getByText(/anchor turn is not complete/i)).toBeTruthy();
  });

  it("does not infer native provenance for legacy Side Chat records", () => {
    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat({ seeded: true })} onClose={() => {}} />);

    expect(screen.getByText("Legacy status unknown")).toBeTruthy();
    expect(screen.getByText(/Context provenance is unknown/i)).toBeTruthy();
    expect(screen.queryByText("Native fork")).toBeNull();
  });

  it("surfaces disconnected, reconnecting, generating, backend, queued, and permission states from the hidden child", () => {
    seedRootAndChild({
      childConnected: false,
      child: {
        backend_state: "recovering",
        backend_error: "stream disconnected before completion",
      },
    });
    const store = useStore.getState();
    store.setSessionStatus("hidden-child", "running");
    store.setStreamingStats("hidden-child", { startedAt: Date.now() - 1000, outputTokens: 42 });
    store.setPendingCodexInputs("hidden-child", [makePendingInput()]);
    store.addPermission("hidden-child", makePermission());
    store.setMessages("hidden-child", [
      {
        id: "denied-1",
        role: "system",
        content: "Thread turns are read-only.",
        timestamp: 200,
        variant: "denied",
      },
    ]);

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    expect(screen.getByText("Reconnecting")).toBeTruthy();
    expect(screen.getByText("Generating")).toBeTruthy();
    expect(screen.getByText("Queued send")).toBeTruthy();
    expect(screen.getByText("Backend error")).toBeTruthy();
    expect(screen.getByText("Permission needed")).toBeTruthy();
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getByText(/Side Chat remains read-only/i)).toBeTruthy();
  });

  it("shows recoverable disconnected state for hidden child sessions", () => {
    seedRootAndChild({ childConnected: false, child: { backend_state: "disconnected" } });

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    expect(screen.getByText("Disconnected")).toBeTruthy();
    expect(screen.getByText(/reconnects automatically when backend delivery is needed/i)).toBeTruthy();
  });

  it("prevents silent sends when the hidden child session is unavailable", async () => {
    const user = userEvent.setup();
    useStore.getState().addSession(makeSession("root", { slackThreads: { "st-1": makeSideChat() } }));

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText("Reply in Side Chat..."), "Can you continue?");
    expect(screen.getByText("Hidden session unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendSideChatMessageMock).not.toHaveBeenCalled();
  });

  it("keeps the draft and shows a visible send failure when the route rejects the message", async () => {
    const user = userEvent.setup();
    seedRootAndChild();
    sendSideChatMessageMock.mockRejectedValueOnce(new Error("Hidden Side Chat session not found"));

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    const composer = screen.getByPlaceholderText("Reply in Side Chat...");
    await user.type(composer, "Can you compare the risks?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Send failed")).toBeTruthy();
    expect(screen.getByText(/Hidden Side Chat session not found/i)).toBeTruthy();
    expect(composer).toHaveValue("Can you compare the risks?");
    expect(connectSessionMock).not.toHaveBeenCalled();
  });

  it("shows local sending state and then an accepted queued notice when the child is disconnected", async () => {
    const user = userEvent.setup();
    seedRootAndChild({ childConnected: false, child: { backend_state: "disconnected" } });
    let resolveSend: (value: { ok: true; childSessionId: string }) => void = () => {};
    sendSideChatMessageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    const composer = screen.getByPlaceholderText("Reply in Side Chat...");
    await user.type(composer, "Queue this follow-up");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getAllByText("Sending").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Delivering your Side Chat message to Takode/i)).toBeTruthy();

    resolveSend({ ok: true, childSessionId: "hidden-child" });

    await waitFor(() => {
      expect(screen.getByText("Queued")).toBeTruthy();
      expect(screen.getByText(/queued while the hidden Side Chat backend reconnects/i)).toBeTruthy();
    });
    expect(composer).toHaveValue("");
    expect(connectSessionMock).toHaveBeenCalledWith("hidden-child");
  });
});
