import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerSessionSideChatRoutes } from "./routes/session-side-chat-routes.js";
import type { BrowserIncomingMessage, SessionState } from "./session-types.js";

vi.mock("./session-names.js", () => ({
  setName: vi.fn(),
}));

function assistant(id: string, text: string): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.5",
      content: [{ type: "text", text }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1,
    uuid: id,
  };
}

function user(id: string, content: string): Extract<BrowserIncomingMessage, { type: "user_message" }> {
  return { type: "user_message", id, content, timestamp: 1 };
}

function result(): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: "result",
      session_id: "root",
    },
  } as BrowserIncomingMessage;
}

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: "root",
    model: "gpt-5.5",
    cwd: "/repo",
    tools: [],
    permissionMode: "codex-default",
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

describe("Side Chat session routes", () => {
  it("launches hidden Codex children with the root session env profile and runtime env", async () => {
    const root = {
      id: "root",
      state: makeState({ backend_type: "codex", memorySessionSpaceSlug: "Takode" }),
      messageHistory: [user("u1", "Explain this"), assistant("anchor-1", "Root answer"), result()],
      codexAdapter: {
        isConnected: () => true,
        forkThread: vi.fn(async () => "forked-codex-thread"),
      },
    };
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      messageHistory: [],
    };
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "root"
          ? {
              sessionId: "root",
              backendType: "codex",
              cwd: "/repo",
              model: "gpt-5.5",
              permissionMode: "codex-default",
              askPermission: true,
              uiMode: "agent",
              codexInternetAccess: true,
              codexReasoningEffort: "high",
              envSlug: "codex-profile",
            }
          : null,
      ),
      getSessionLaunchEnv: vi.fn(() => ({
        LITELLM_API_KEY: "profile-secret",
        PROFILE_ONLY: "kept",
        COMPANION_PORT: "3467",
        COMPANION_AUTH_TOKEN: "root-auth",
        COMPANION_SESSION_ID: "root",
        COMPANION_SESSION_NUMBER: "42",
        TAKODE_ROLE: "orchestrator",
        TAKODE_API_PORT: "3467",
      })),
      launch: vi.fn(async () => ({
        sessionId: "child",
        backendType: "codex",
        cwd: "/repo",
        createdAt: 2,
        state: "starting" as const,
      })),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(() => childSession),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: "codex",
        permissionMode: "codex-default",
        askPermission: true,
        uiMode: "agent",
        codexSandbox: "read-only",
        codexInternetAccess: true,
        codexReasoningEffort: "high",
        envSlug: "codex-profile",
        blockedEnvKeys: [
          "COMPANION_AUTH_TOKEN",
          "COMPANION_SESSION_ID",
          "COMPANION_SESSION_NUMBER",
          "TAKODE_ROLE",
          "TAKODE_API_PORT",
        ],
        env: {
          LITELLM_API_KEY: "profile-secret",
          PROFILE_ONLY: "kept",
          COMPANION_PORT: "3467",
        },
        hidden: true,
        parentSessionId: "root",
        sideChatReadOnly: true,
      }),
    );
    const launchOptions = (launcher.launch as unknown as { mock: { calls: Array<[{ env?: Record<string, string> }]> } })
      .mock.calls[0][0];
    expect(launchOptions.env).not.toHaveProperty("COMPANION_AUTH_TOKEN");
    expect(launchOptions.env).not.toHaveProperty("COMPANION_SESSION_ID");
    expect(launchOptions.env).not.toHaveProperty("TAKODE_ROLE");
    expect(childSession.state.permissionMode).toBe("codex-default");
  });

  it("uses Codex thread/fork and resumes the hidden child from the forked thread", async () => {
    const forkThread = vi.fn(async () => "forked-codex-thread");
    const root = {
      id: "root",
      state: makeState({ backend_type: "codex" }),
      messageHistory: [user("u1", "Explain this"), assistant("anchor-1", "Root answer"), result()],
      codexAdapter: {
        isConnected: () => true,
        forkThread,
      },
    };
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      messageHistory: [],
    };
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "root"
          ? {
              sessionId: "root",
              backendType: "codex",
              cwd: "/repo",
              model: "gpt-5.5",
              permissionMode: "codex-default",
              askPermission: true,
              uiMode: "agent",
            }
          : null,
      ),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(async () => ({
        sessionId: "child",
        backendType: "codex",
        cwd: "/repo",
        createdAt: 2,
        state: "starting" as const,
      })),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(() => childSession),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(200);
    expect(forkThread).toHaveBeenCalledWith({ rollbackTurns: undefined });
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ resumeCliSessionId: "forked-codex-thread" }),
    );
    const json = await res.json();
    expect(json.sideChat.seeded).toBe(true);
    expect(json.sideChat.contextStrategy).toBe("native-fork");
    expect(json.thread.id).toBe(json.sideChat.id);
    expect(childSession.state.slackThreadChild?.contextStrategy).toBe("native-fork");
  });

  it("preflights Codex unsafe anchors before creating a Side Chat", async () => {
    const root = {
      id: "root",
      state: makeState({ backend_type: "codex" }),
      messageHistory: [
        user("u1", "Explain this"),
        assistant("anchor-1", "Partial answer"),
        assistant("anchor-2", "Final answer"),
        result(),
      ],
      codexAdapter: {
        isConnected: () => true,
        forkThread: vi.fn(),
      },
    };
    const launcher = {
      getSession: vi.fn(() => ({ sessionId: "root", backendType: "codex", cwd: "/repo", model: "gpt-5.5" })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.native).toMatchObject({
      eligible: false,
      reasonCode: "codex-anchor-not-final-assistant",
    });
    expect(json.fallback).toMatchObject({
      available: true,
      requiresConfirmation: true,
      reasonCode: "codex-anchor-not-final-assistant",
    });
  });

  it("keeps legacy slack-threads creation route as a compatibility alias", async () => {
    const root = {
      id: "root",
      state: makeState({
        backend_type: "codex",
        slackThreads: {
          "st-existing": {
            id: "st-existing",
            rootSessionId: "root",
            childSessionId: "child-session",
            anchorMessageId: "anchor-1",
            anchorHistoryIndex: 0,
            anchorPreview: "Root answer",
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            seeded: true,
          },
        },
      }),
      messageHistory: [assistant("anchor-1", "Root answer")],
    };
    const launcher = {
      getSession: vi.fn(() => ({ sessionId: "root", backendType: "codex", cwd: "/repo", model: "gpt-5.5" })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/slack-threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sideChat.id).toBe("st-existing");
    expect(json.thread.id).toBe("st-existing");
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(wsBridge.syncSideChatRecord).toHaveBeenCalledWith("root", "st-existing");
  });

  it("uses Claude SDK forkSession for message-anchor hidden children", async () => {
    const root = {
      id: "root",
      state: makeState({ backend_type: "claude-sdk", model: "claude-sonnet" }),
      messageHistory: [assistant("anchor-1", "Root answer")],
    };
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "claude-sdk" }),
      messageHistory: [],
    };
    const forkClaudeSession = vi.fn(async () => ({ sessionId: "forked-claude-session" }));
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "root"
          ? {
              sessionId: "root",
              backendType: "claude-sdk",
              cliSessionId: "parent-claude-session",
              cwd: "/repo",
              model: "claude-sonnet",
              askPermission: true,
            }
          : null,
      ),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(async () => ({
        sessionId: "child",
        backendType: "claude-sdk",
        cwd: "/repo",
        createdAt: 2,
        state: "connected" as const,
      })),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(() => childSession),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
          forkClaudeSession,
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(200);
    expect(forkClaudeSession).toHaveBeenCalledWith("parent-claude-session", {
      dir: "/repo",
      title: "Side Chat: Root answer",
      upToMessageId: "anchor-1",
    });
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ resumeCliSessionId: "forked-claude-session" }),
    );
    const json = await res.json();
    expect(json.sideChat.seeded).toBe(true);
    expect(json.sideChat.contextStrategy).toBe("native-fork");
  });

  it("blocks silent bounded replay when Codex native fork cannot represent the anchor safely", async () => {
    const root = {
      id: "root",
      state: makeState({ backend_type: "codex" }),
      messageHistory: [
        user("u1", "Explain this"),
        assistant("anchor-1", "Partial answer"),
        assistant("anchor-2", "Final answer"),
        result(),
      ],
      codexAdapter: {
        isConnected: () => true,
        forkThread: vi.fn(),
      },
    };
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      messageHistory: [],
    };
    const launcher = {
      getSession: vi.fn(() => ({
        sessionId: "root",
        backendType: "codex",
        cwd: "/repo",
        model: "gpt-5.5",
      })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(async () => ({
        sessionId: "child",
        backendType: "codex",
        cwd: "/repo",
        createdAt: 2,
        state: "starting" as const,
      })),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(() => childSession),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(409);
    expect(root.codexAdapter.forkThread).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.reasonCode).toBe("codex-anchor-not-final-assistant");
    expect(json.preflight.fallback.available).toBe(true);
  });

  it("creates bounded replay only with explicit fallback opt-in", async () => {
    const root = {
      id: "root",
      state: makeState({ backend_type: "codex" }),
      messageHistory: [
        user("u1", "Explain this"),
        assistant("anchor-1", "Partial answer"),
        assistant("anchor-2", "Final answer"),
        result(),
      ],
      codexAdapter: {
        isConnected: () => true,
        forkThread: vi.fn(),
      },
    };
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      messageHistory: [],
    };
    const launcher = {
      getSession: vi.fn(() => ({
        sessionId: "root",
        backendType: "codex",
        cwd: "/repo",
        model: "gpt-5.5",
      })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(async () => ({
        sessionId: "child",
        backendType: "codex",
        cwd: "/repo",
        createdAt: 2,
        state: "starting" as const,
      })),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(() => childSession),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1", fallbackMode: "allow-bounded-replay" }),
    });

    expect(res.status).toBe(200);
    expect(root.codexAdapter.forkThread).not.toHaveBeenCalled();
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.not.objectContaining({ resumeCliSessionId: expect.any(String) }),
    );
    const json = await res.json();
    expect(json.sideChat.seeded).toBe(false);
    expect(json.sideChat.contextStrategy).toBe("bounded-replay");
    expect(json.sideChat.contextFallbackReasonCode).toBe("codex-anchor-not-final-assistant");
    expect(json.sideChat.contextFallbackReason).toContain("Codex native fork skipped");
    expect(childSession.state.slackThreadChild?.contextFallbackReasonCode).toBe("codex-anchor-not-final-assistant");
  });

  it("rejects leader sessions before creating or reopening Side Chats", async () => {
    const root = {
      id: "leader",
      state: makeState({
        session_id: "leader",
        backend_type: "codex",
        isOrchestrator: true,
        slackThreads: {
          "st-existing": {
            id: "st-existing",
            rootSessionId: "leader",
            childSessionId: "child-session",
            anchorMessageId: "anchor-1",
            anchorHistoryIndex: 1,
            anchorPreview: "Root answer",
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            seeded: true,
          },
        },
      }),
      messageHistory: [assistant("anchor-1", "Root answer")],
    };
    const launcher = {
      getSession: vi.fn(() => ({
        sessionId: "leader",
        backendType: "codex",
        cwd: "/repo",
        model: "gpt-5.5",
        isOrchestrator: true,
      })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "leader" ? root : null)),
      getOrCreateSession: vi.fn(),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "leader" ? "leader" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/leader/side-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchorMessageId: "anchor-1" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Side Chats are disabled for leader sessions" });
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(wsBridge.syncSideChatRecord).not.toHaveBeenCalled();
  });

  it("rejects leader sessions before routing messages to existing Side Chats", async () => {
    const root = {
      id: "leader",
      state: makeState({ session_id: "leader", backend_type: "claude", isOrchestrator: true }),
      messageHistory: [assistant("anchor-1", "Root answer")],
    };
    const launcher = {
      getSession: vi.fn(() => ({
        sessionId: "leader",
        backendType: "claude",
        cwd: "/repo",
        model: "claude-sonnet",
        isOrchestrator: true,
      })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "leader" ? root : null)),
      getOrCreateSession: vi.fn(),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
      routeSideChatUserMessage: vi.fn(),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "leader" ? "leader" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/leader/side-chats/st-existing/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "continue here" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Side Chats are disabled for leader sessions" });
    expect(wsBridge.routeSideChatUserMessage).not.toHaveBeenCalled();
  });

  it("uses Side Chat wording when the new message route targets an unknown Side Chat", async () => {
    const root = {
      id: "root",
      state: makeState({ session_id: "root", backend_type: "claude" }),
      messageHistory: [assistant("anchor-1", "Root answer")],
    };
    const launcher = {
      getSession: vi.fn(() => ({
        sessionId: "root",
        backendType: "claude",
        cwd: "/repo",
        model: "claude-sonnet",
      })),
      getSessionLaunchEnv: vi.fn(),
      launch: vi.fn(),
      touchActivity: vi.fn(),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => (id === "root" ? root : null)),
      getOrCreateSession: vi.fn(),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      syncSideChatRecord: vi.fn(),
      routeSideChatUserMessage: vi.fn(async () => ({ ok: false as const, error: "Side Chat not found" })),
    };
    const app = new Hono();
    app.route(
      "/api",
      (() => {
        const api = new Hono();
        registerSessionSideChatRoutes(api, {
          launcher: launcher as never,
          wsBridge: wsBridge as never,
          resolveId: (id) => (id === "root" ? "root" : null),
        });
        return api;
      })(),
    );

    const res = await app.request("/api/sessions/root/side-chats/missing/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "continue here" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Side Chat not found" });
  });
});
