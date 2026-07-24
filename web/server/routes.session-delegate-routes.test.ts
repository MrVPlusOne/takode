import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSessionDelegateRoutes } from "./routes/session-delegate-routes.js";
import type { SessionState } from "./session-types.js";

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: "session",
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

describe("delegate command routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forks a Codex leader into a hidden child and returns compact summary plus session link", async () => {
    const sentToChild: unknown[] = [];
    const childOrder: string[] = [];
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      waitForMcpToolAvailability: vi.fn(async () => {
        childOrder.push("wait");
        return true;
      }),
      sendBrowserMessage: vi.fn((msg: unknown) => {
        childOrder.push("send");
        sentToChild.push(msg);
        return true;
      }),
    };
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({
        session_id: "parent",
        backend_type: "codex",
        cwd: "/repo",
        model: "gpt-5.5",
        treeGroupId: "leaders",
        memorySessionSpaceSlug: "Takode",
        isOrchestrator: true,
      }),
      codexAdapter: parentAdapter,
    });
    sessions.set("child", {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: childAdapter,
      isGenerating: false,
      messageHistory: [],
    });

    const guardrails = "leader guardrails";
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "parent"
          ? {
              sessionId: "parent",
              backendType: "codex",
              cwd: "/repo",
              model: "gpt-5.5",
              permissionMode: "codex-default",
              askPermission: true,
              uiMode: "agent",
              codexSandbox: "workspace-write",
              codexInternetAccess: true,
              codexReasoningEffort: "high",
              codexServiceTier: null,
              isOrchestrator: true,
            }
          : id === "child"
            ? {
                sessionId: "child",
                backendType: "codex",
                cwd: "/repo",
                model: "gpt-5.5",
                hidden: true,
                isOrchestrator: true,
              }
            : null,
      ),
      getPort: vi.fn(() => 3456),
      getOrchestratorGuardrails: vi.fn(() => guardrails),
      launch: vi.fn(async (options: Record<string, unknown>) => {
        expect(options).toMatchObject({
          backendType: "codex",
          resumeCliSessionId: "forked-thread",
          hidden: true,
          parentSessionId: "parent",
          extraInstructions: guardrails,
          isOrchestrator: true,
          env: {
            TAKODE_ROLE: "orchestrator",
            TAKODE_API_PORT: "3456",
            TAKODE_DELEGATE_ROLE: "child",
            TAKODE_DELEGATE_PARENT_SESSION_ID: "parent",
          },
        });
        return { sessionId: "child", hidden: true, parentSessionId: "parent", noAutoName: false };
      }),
      getSessionNum: vi.fn((id: string) => (id === "parent" ? 2220 : id === "child" ? 2266 : undefined)),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => sessions.get(id)),
      getOrCreateSession: vi.fn((id: string) => sessions.get(id)),
      persistSessionById: vi.fn(),
    };
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: launcher as any,
      wsBridge: wsBridge as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: (c) => ({ callerId: c.req.path.includes("/child/") ? "child" : "parent" }),
    });

    const parentRequest = app.request("/sessions/parent/delegates/command", {
      method: "POST",
      body: JSON.stringify({ command: "rg -n large-output web" }),
      headers: { "content-type": "application/json" },
    });
    await vi.waitFor(() => {
      expect(sentToChild.length).toBe(1);
    });
    const childPrompt = sentToChild[0] as { content: string };
    expect(childOrder).toEqual(["wait", "send"]);
    expect(childAdapter.waitForMcpToolAvailability).toHaveBeenCalledWith("takode_delegate", "end_delegation", 10_000);
    expect(childPrompt.content).toContain("forked command-delegate copy");
    expect(childPrompt.content).toContain("You may see delegate_command and end_delegation");
    expect(childPrompt.content).toContain("call the actual MCP tool mcp:takode_delegate:end_delegation");
    expect(childPrompt.content).toContain("Do not write textual function-call prose");
    expect(childPrompt.content).toContain("Text shaped like a function call does not notify the parent");
    expect(childPrompt.content).toContain("Do not finish with a normal final answer");
    expect(childPrompt.content).toContain("rg -n large-output web");

    const delegateId = (sessions.get("child").state as any).delegateChild.delegateId;
    const endResponse = await app.request("/sessions/child/delegates/end", {
      method: "POST",
      body: JSON.stringify({ delegateId, summary: "Found 12 large output call sites." }),
      headers: { "content-type": "application/json" },
    });
    expect(endResponse.status).toBe(200);

    const parentResponse = await parentRequest;
    const parentJson = (await parentResponse.json()) as { text: string; childSessionNum: number; delegateId: string };
    expect(parentJson.text).toContain("Delegate command completed.");
    expect(parentJson.text).toContain("Found 12 large output call sites.");
    expect(parentJson.text).toContain("[#2266](session:2266)");
    expect(parentJson.text).not.toContain("raw stdout");
    expect(parentJson.childSessionNum).toBe(2266);
    expect(parentJson.delegateId).toBe(delegateId);
  });

  it("fails closed instead of prompting the child before end_delegation is available", async () => {
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      waitForMcpToolAvailability: vi.fn(async () => false),
      sendBrowserMessage: vi.fn(),
    };
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({
        session_id: "parent",
        backend_type: "codex",
        cwd: "/repo",
        model: "gpt-5.5",
        isOrchestrator: true,
      }),
      codexAdapter: parentAdapter,
    });
    sessions.set("child", {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: childAdapter,
      isGenerating: false,
      messageHistory: [],
    });

    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "parent"
          ? {
              sessionId: "parent",
              backendType: "codex",
              cwd: "/repo",
              model: "gpt-5.5",
              permissionMode: "codex-default",
              askPermission: true,
              uiMode: "agent",
              isOrchestrator: true,
            }
          : id === "child"
            ? { sessionId: "child", backendType: "codex", cwd: "/repo", model: "gpt-5.5", hidden: true }
            : null,
      ),
      getPort: vi.fn(() => 3456),
      getOrchestratorGuardrails: vi.fn(() => "leader guardrails"),
      launch: vi.fn(async () => ({ sessionId: "child", hidden: true, parentSessionId: "parent", noAutoName: false })),
      getSessionNum: vi.fn((id: string) => (id === "parent" ? 2220 : id === "child" ? 2266 : undefined)),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => sessions.get(id)),
      getOrCreateSession: vi.fn((id: string) => sessions.get(id)),
      persistSessionById: vi.fn(),
    };
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: launcher as any,
      wsBridge: wsBridge as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: () => ({ callerId: "parent" }),
    });

    const res = await app.request("/sessions/parent/delegates/command", {
      method: "POST",
      body: JSON.stringify({ command: "sed -n '1,3p' sample.txt" }),
      headers: { "content-type": "application/json" },
    });
    const json = (await res.json()) as { error: string; delegateId: string; childSessionId: string };
    expect(res.status).toBe(504);
    expect(json.error).toContain("end_delegation tool did not become available");
    expect(json.delegateId).toEqual(expect.stringMatching(/^del_/));
    expect(json.childSessionId).toBe("child");
    expect(childAdapter.waitForMcpToolAvailability).toHaveBeenCalledWith("takode_delegate", "end_delegation", 10_000);
    expect(childAdapter.sendBrowserMessage).not.toHaveBeenCalled();
  });

  it("does not resolve early when the child emits interim text before end_delegation", async () => {
    vi.useFakeTimers();
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: {
        isConnected: () => true,
        waitForMcpToolAvailability: vi.fn(async () => true),
        sendBrowserMessage: vi.fn(() => {
          childSession.isGenerating = false;
          childSession.messageHistory.push({
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Running the delegated command now, then I’ll report back." }],
            },
          });
          return true;
        }),
      },
      isGenerating: false,
      messageHistory: [] as unknown[],
    };
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({ session_id: "parent", backend_type: "codex", isOrchestrator: true }),
      codexAdapter: {
        isConnected: () => true,
        forkThread: vi.fn(async () => "forked-thread"),
      },
    });
    sessions.set("child", childSession);
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "parent"
          ? {
              sessionId: "parent",
              backendType: "codex",
              cwd: "/repo",
              model: "gpt-5.5",
              permissionMode: "codex-default",
              askPermission: true,
              uiMode: "agent",
              isOrchestrator: true,
            }
          : id === "child"
            ? {
                sessionId: "child",
                backendType: "codex",
                cwd: "/repo",
                model: "gpt-5.5",
                hidden: true,
                isOrchestrator: true,
              }
            : null,
      ),
      getPort: vi.fn(() => 3456),
      getOrchestratorGuardrails: vi.fn(() => "leader guardrails"),
      launch: vi.fn(async () => ({ sessionId: "child", hidden: true, parentSessionId: "parent", noAutoName: false })),
      getSessionNum: vi.fn((id: string) => (id === "parent" ? 2220 : id === "child" ? 2266 : undefined)),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => sessions.get(id)),
      getOrCreateSession: vi.fn((id: string) => sessions.get(id)),
      persistSessionById: vi.fn(),
    };
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: launcher as any,
      wsBridge: wsBridge as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: (c) => ({ callerId: c.req.path.includes("/child/") ? "child" : "parent" }),
    });

    const parentRequest = app.request("/sessions/parent/delegates/command", {
      method: "POST",
      body: JSON.stringify({ command: "printf ok" }),
      headers: { "content-type": "application/json" },
    });
    await vi.waitFor(() => {
      expect(childSession.codexAdapter.sendBrowserMessage).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(1_000);

    const delegateId = (sessions.get("child").state as any).delegateChild.delegateId;
    const endResponse = await app.request("/sessions/child/delegates/end", {
      method: "POST",
      body: JSON.stringify({ delegateId, summary: "The command completed after interim text." }),
      headers: { "content-type": "application/json" },
    });
    expect(endResponse.status).toBe(200);

    const parentResponse = await parentRequest;
    const parentJson = (await parentResponse.json()) as { text: string; isError?: boolean };
    expect(parentResponse.status).toBe(200);
    expect(parentJson.isError).toBeUndefined();
    expect(parentJson.text).toContain("Delegate command completed.");
    expect(parentJson.text).toContain("The command completed after interim text.");
  });

  it("returns a bounded parent-visible timeout when the child never calls end_delegation", async () => {
    vi.useFakeTimers();
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: {
        isConnected: () => true,
        waitForMcpToolAvailability: vi.fn(async () => true),
        sendBrowserMessage: vi.fn(() => {
          return true;
        }),
      },
      isGenerating: false,
      messageHistory: [] as unknown[],
    };
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({ session_id: "parent", backend_type: "codex", isOrchestrator: true }),
      codexAdapter: {
        isConnected: () => true,
        forkThread: vi.fn(async () => "forked-thread"),
      },
    });
    sessions.set("child", childSession);
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "parent"
          ? {
              sessionId: "parent",
              backendType: "codex",
              cwd: "/repo",
              model: "gpt-5.5",
              permissionMode: "codex-default",
              askPermission: true,
              uiMode: "agent",
              isOrchestrator: true,
            }
          : id === "child"
            ? {
                sessionId: "child",
                backendType: "codex",
                cwd: "/repo",
                model: "gpt-5.5",
                hidden: true,
                isOrchestrator: true,
              }
            : null,
      ),
      getPort: vi.fn(() => 3456),
      getOrchestratorGuardrails: vi.fn(() => "leader guardrails"),
      launch: vi.fn(async () => ({ sessionId: "child", hidden: true, parentSessionId: "parent", noAutoName: false })),
      getSessionNum: vi.fn((id: string) => (id === "parent" ? 2220 : id === "child" ? 2266 : undefined)),
    };
    const wsBridge = {
      getSession: vi.fn((id: string) => sessions.get(id)),
      getOrCreateSession: vi.fn((id: string) => sessions.get(id)),
      persistSessionById: vi.fn(),
    };
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: launcher as any,
      wsBridge: wsBridge as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: () => ({ callerId: "parent" }),
    });

    const parentRequest = app.request("/sessions/parent/delegates/command", {
      method: "POST",
      body: JSON.stringify({ command: "printf ok" }),
      headers: { "content-type": "application/json" },
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const parentResponse = await parentRequest;
    const parentJson = (await parentResponse.json()) as { text: string; isError: boolean };
    expect(parentResponse.status).toBe(200);
    expect(parentJson.isError).toBe(true);
    expect(parentJson.text).toContain("Delegate command failed.");
    expect(parentJson.text).toContain("timed out before calling end_delegation");
  });

  it("rejects nested delegate_command calls from hidden delegate children even when the tool is visible", async () => {
    const sessions = new Map<string, any>();
    sessions.set("child", {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex", hidden: true }),
      codexAdapter: { isConnected: () => true, forkThread: vi.fn() },
    });
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: {
        getSession: vi.fn(() => ({ sessionId: "child", backendType: "codex", hidden: true, isOrchestrator: true })),
      } as any,
      wsBridge: { getSession: vi.fn((id: string) => sessions.get(id)) } as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: () => ({ callerId: "child", caller: { isOrchestrator: true } }),
    });

    const response = await app.request("/sessions/child/delegates/command", {
      method: "POST",
      body: JSON.stringify({ command: "printf nested" }),
      headers: { "content-type": "application/json" },
    });
    const json = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(json.error).toContain("hidden delegate sessions");
  });

  it("rejects end_delegation from non-delegate sessions even when the tool is visible", async () => {
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({ session_id: "parent", backend_type: "codex", hidden: false }),
    });
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: {
        getSession: vi.fn(() => ({ sessionId: "parent", backendType: "codex", hidden: false, isOrchestrator: true })),
      } as any,
      wsBridge: { getSession: vi.fn((id: string) => sessions.get(id)) } as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: () => ({ callerId: "parent", caller: { isOrchestrator: true } }),
    });

    const response = await app.request("/sessions/parent/delegates/end", {
      method: "POST",
      body: JSON.stringify({ delegateId: "del_123", summary: "done" }),
      headers: { "content-type": "application/json" },
    });
    const json = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(json.error).toContain("active hidden delegate child");
  });
});
