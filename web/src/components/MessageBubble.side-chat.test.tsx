// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatMessage, SessionState, SideChatRecord } from "../types.js";

const preflightSideChatMock = vi.hoisted(() =>
  vi.fn(async (_sessionId: string, anchorMessageId: string) => ({
    ok: true,
    anchorMessageId,
    backendType: "codex",
    native: { eligible: true },
    fallback: { available: false, requiresConfirmation: true },
  })),
);
const createSideChatMock = vi.hoisted(() =>
  vi.fn(async (_sessionId: string, anchorMessageId: string) => ({
    ok: true,
    sideChat: makeSideChat({
      id: "st-created",
      rootSessionId: "root-session",
      childSessionId: "child-created",
      anchorMessageId,
      messageCount: 0,
      contextStrategy: "native-fork",
    }),
  })),
);

vi.mock("../api.js", () => ({
  api: {
    preflightSideChat: preflightSideChatMock,
    createSideChat: createSideChatMock,
  },
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { useStore } from "../store.js";
import { MessageBubble } from "./MessageBubble.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
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

function makeSideChat(overrides: Partial<SideChatRecord> = {}): SideChatRecord {
  return {
    id: "st-test",
    rootSessionId: "root-session",
    childSessionId: "child-session",
    anchorMessageId: "assistant-anchor",
    anchorHistoryIndex: 1,
    anchorPreview: "Root answer",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 2,
    seeded: true,
    ...overrides,
  };
}

describe("MessageBubble Side Chat actions", () => {
  beforeEach(() => {
    useStore.getState().reset();
    preflightSideChatMock.mockClear();
    preflightSideChatMock.mockImplementation(async (_sessionId: string, anchorMessageId: string) => ({
      ok: true,
      anchorMessageId,
      backendType: "codex",
      native: { eligible: true },
      fallback: { available: false, requiresConfirmation: true },
    }));
    createSideChatMock.mockClear();
  });

  it("renders a visible Side Chat summary for root assistant messages with server-owned Side Chat records", () => {
    const sessionId = "session-with-side-chat";
    const msg = makeMessage({ id: "assistant-anchor", role: "assistant", content: "Root answer" });
    useStore.getState().addSession(
      makeSession(sessionId, {
        backend_type: "claude",
        model: "claude-sonnet",
        slackThreads: {
          "st-test": makeSideChat({
            rootSessionId: sessionId,
            lastMessagePreview: "Side Chat follow-up",
            contextStrategy: "native-fork",
          }),
        },
      }),
    );

    render(<MessageBubble message={msg} sessionId={sessionId} currentThreadKey="main" />);

    expect(screen.getByText("2 replies")).toBeTruthy();
    expect(screen.getByText("Native fork")).toBeTruthy();
    expect(screen.getByText("Side Chat follow-up")).toBeTruthy();
  });

  it("labels existing bounded-replay and legacy Side Chat summaries without inferring from seeded", () => {
    const sessionId = "session-with-fallback-side-chat";
    const fallbackMsg = makeMessage({ id: "fallback-anchor", role: "assistant", content: "Fallback answer" });
    const legacyMsg = makeMessage({ id: "legacy-anchor", role: "assistant", content: "Legacy answer" });
    useStore.getState().addSession(
      makeSession(sessionId, {
        slackThreads: {
          "st-fallback": makeSideChat({
            id: "st-fallback",
            rootSessionId: sessionId,
            childSessionId: "child-fallback",
            anchorMessageId: "fallback-anchor",
            contextStrategy: "bounded-replay",
            contextFallbackReason: "Codex native fork skipped: anchor turn is not complete",
          }),
          "st-legacy": makeSideChat({
            id: "st-legacy",
            rootSessionId: sessionId,
            childSessionId: "child-legacy",
            anchorMessageId: "legacy-anchor",
            anchorHistoryIndex: 2,
          }),
        },
      }),
    );

    render(
      <div>
        <MessageBubble message={fallbackMsg} sessionId={sessionId} currentThreadKey="main" />
        <MessageBubble message={legacyMsg} sessionId={sessionId} currentThreadKey="main" />
      </div>,
    );

    expect(screen.getByText("Bounded replay")).toBeTruthy();
    expect(screen.getByText("Legacy status unknown")).toBeTruthy();
  });

  it("suppresses Side Chat controls and summaries for leader sessions", () => {
    const sessionId = "leader-with-side-chat";
    const msg = makeMessage({ id: "assistant-anchor", role: "assistant", content: "Leader root answer" });
    useStore.getState().addSession(
      makeSession(sessionId, {
        isOrchestrator: true,
        slackThreads: {
          "st-test": makeSideChat({ rootSessionId: sessionId, lastMessagePreview: "Side Chat follow-up" }),
        },
      }),
    );

    render(<MessageBubble message={msg} sessionId={sessionId} currentThreadKey="main" />);

    expect(screen.queryByText("2 replies")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start Side Chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Side Chat with/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("keeps Side Chat creation available for native-eligible root assistant messages", async () => {
    const msg = makeMessage({ id: "assistant-anchor", role: "assistant", content: "Root answer" });

    const { container } = render(<MessageBubble message={msg} sessionId="root-session" currentThreadKey="main" />);

    const toolbar = container.querySelector("[data-message-action-toolbar]");
    const startSideChat = await screen.findByRole("button", { name: "Start Side Chat" });
    await waitFor(() => expect(startSideChat).not.toBeDisabled());
    expect(toolbar).toBeTruthy();
    expect(toolbar?.className).not.toContain("absolute");
    expect(toolbar?.className).toContain("shrink-0");
    expect(startSideChat.className).toContain("h-7");
  });

  it("keeps Side Chat creation available for native-eligible herded worker sessions", async () => {
    const prevSdkSessions = useStore.getState().sdkSessions;
    useStore.setState({
      sdkSessions: [
        ...prevSdkSessions,
        { sessionId: "worker-session", state: "connected", cwd: "/repo", createdAt: 1, herdedBy: "leader-session" },
      ] as never,
    });

    try {
      const msg = makeMessage({ id: "assistant-anchor", role: "assistant", content: "Worker answer" });
      render(<MessageBubble message={msg} sessionId="worker-session" currentThreadKey="main" />);

      const startSideChat = await screen.findByRole("button", { name: "Start Side Chat" });
      await waitFor(() => expect(startSideChat).not.toBeDisabled());
    } finally {
      useStore.setState({ sdkSessions: prevSdkSessions });
    }
  });

  it("blocks native Side Chat and requires explicit bounded replay confirmation when preflight says fallback only", async () => {
    preflightSideChatMock.mockImplementationOnce(async (_sessionId: string, anchorMessageId: string) => ({
      ok: true,
      anchorMessageId,
      backendType: "codex",
      native: {
        eligible: false,
        reason: "Codex native fork skipped: anchor is not the final assistant message in its Codex turn",
        reasonCode: "codex-anchor-not-final-assistant",
      },
      fallback: {
        available: true,
        requiresConfirmation: true,
        reason: "Codex native fork skipped: anchor is not the final assistant message in its Codex turn",
        reasonCode: "codex-anchor-not-final-assistant",
      },
    }));
    const msg = makeMessage({ id: "assistant-anchor", role: "assistant", content: "Root answer" });
    render(<MessageBubble message={msg} sessionId="root-session" currentThreadKey="main" />);

    const startSideChat = await screen.findByRole("button", { name: "Start Side Chat" });
    await waitFor(() => expect(startSideChat).toBeDisabled());
    expect(
      screen.getByText(
        /Native fork unavailable: Codex native fork skipped: anchor is not the final assistant message/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Bounded replay requires confirmation/i)).toBeTruthy();
    const replay = await screen.findByRole("button", { name: /Use bounded replay Side Chat/i });

    await userEvent.click(replay);
    expect(createSideChatMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Use bounded replay Side Chat/i }).textContent).toBe("Confirm replay");

    await userEvent.click(screen.getByRole("button", { name: /Use bounded replay Side Chat/i }));
    await waitFor(() =>
      expect(createSideChatMock).toHaveBeenCalledWith("root-session", "assistant-anchor", {
        fallbackMode: "allow-bounded-replay",
      }),
    );
  });

  it("suppresses Side Chat creation for assistant messages embedded in a Side Chat panel", () => {
    const msg = makeMessage({ id: "side-chat-assistant", role: "assistant", content: "Side Chat answer" });

    render(
      <MessageBubble
        message={msg}
        sessionId="hidden-thread-child"
        currentThreadKey="main"
        showSideChatActions={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Start Side Chat" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });
});
