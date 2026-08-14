import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSessionDelegateRoutes } from "./routes/session-delegate-routes.js";
import type { SessionState } from "./session-types.js";
import {
  createModelProvenanceMigration,
  resolveUnknownModelProvenanceAuthority,
} from "./cli-launcher-model-authority.js";

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

describe("delegate task routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forks a Codex leader and requires end_delegation even when the task forbids tools", async () => {
    const sentToChild: unknown[] = [];
    const childOrder: string[] = [];
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      getThreadId: () => "forked-thread",
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
    const parentHistory = [{ type: "user_message", content: "parent-only history marker" }];
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
      messageHistory: parentHistory,
    });
    sessions.set("child", {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: childAdapter,
      isGenerating: false,
      messageHistory: [],
    });

    const guardrails = "leader guardrails";
    const migration = createModelProvenanceMigration(
      resolveUnknownModelProvenanceAuthority("gpt-5.6-terra"),
      "legacy_parent",
      123,
    );
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
              codexMultiAgentVersion: "v2",
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
          codexResumeSourceSessionId: "parent",
          codexMultiAgentVersion: "v2",
          requireResumeCliSessionId: true,
          hidden: true,
          publicSessionNumber: false,
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
        return {
          sessionId: "child",
          hidden: true,
          parentSessionId: "parent",
          noAutoName: false,
          publicSessionNumber: false,
          model: "gpt-5.6-terra",
          modelProvenanceMigration: migration,
        };
      }),
      getSessionNum: vi.fn((id: string) => (id === "parent" ? 2220 : undefined)),
      setArchived: vi.fn(),
      kill: vi.fn(async () => true),
      listSessions: vi.fn(() => [
        { sessionId: "parent", createdAt: 1, sessionNum: 2220 },
        { sessionId: "child", createdAt: 2, hidden: true, publicSessionNumber: false },
      ]),
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

    const delegatedTask =
      "Fork-memory probe. Do not use tools, do not run shell commands, and do not inspect quest/session/history records. Answer only from inherited context.";
    const parentRequest = app.request("/sessions/parent/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: delegatedTask }),
      headers: { "content-type": "application/json" },
    });
    await vi.waitFor(() => {
      expect(sentToChild.length).toBe(1);
    });
    const childPrompt = sentToChild[0] as { content: string };
    expect(childOrder).toEqual(["wait", "send"]);
    expect(childAdapter.waitForMcpToolAvailability).toHaveBeenCalledWith("takode_delegate", "end_delegation", 10_000);
    expect(childPrompt.content).toContain("forked task-delegate copy");
    expect(childPrompt.content).toContain("Takode handoff contract:");
    expect(childPrompt.content).toContain("mandatory control-plane handoff");
    expect(childPrompt.content).toContain("Those limits do not forbid the required end_delegation handoff");
    expect(childPrompt.content).toContain("you must always call the actual mcp:takode_delegate:end_delegation tool");
    expect(childPrompt.content).toContain("Delegated task:");
    expect(childPrompt.content).toContain("You may see delegate_task and end_delegation");
    expect(childPrompt.content).toContain("call the actual MCP tool mcp:takode_delegate:end_delegation");
    expect(childPrompt.content).toContain("Do not write textual function-call prose");
    expect(childPrompt.content).toContain("Text shaped like a function call does not notify the parent");
    expect(childPrompt.content).toContain("Do not finish with a normal final answer");
    expect(childPrompt.content).toContain(delegatedTask);
    expect(sessions.get("child").state).toMatchObject({
      model: "gpt-5.6-terra",
      modelProvenanceMigration: migration,
    });

    const delegateId = (sessions.get("child").state as any).delegateChild.delegateId;
    const endResponse = await app.request("/sessions/child/delegates/end", {
      method: "POST",
      body: JSON.stringify({ delegateId, summary: "Found 12 large output call sites." }),
      headers: { "content-type": "application/json" },
    });
    expect(endResponse.status).toBe(200);

    const parentResponse = await parentRequest;
    const parentJson = (await parentResponse.json()) as {
      text: string;
      childSessionNum: number | null;
      delegateId: string;
    };
    expect(parentJson.text).toContain("Delegate task completed.");
    expect(parentJson.text).toContain("Task: " + delegatedTask);
    expect(parentJson.text).toContain("Found 12 large output call sites.");
    expect(parentJson.text).toContain("Delegate: " + delegateId);
    expect(parentJson.text).not.toContain("[#");
    expect(parentJson.text).not.toContain("raw stdout");
    expect(parentJson.childSessionNum).toBeNull();
    expect(parentJson.delegateId).toBe(delegateId);
    expect(launcher.setArchived).toHaveBeenCalledWith("child", true);
    expect(launcher.kill).toHaveBeenCalledWith("child");
    expect(wsBridge.persistSessionById).toHaveBeenCalledWith("child");
    expect(JSON.stringify(sessions.get("child").messageHistory)).not.toContain("parent-only history marker");

    sessions.get("child").messageHistory.push({
      type: "assistant",
      timestamp: 10,
      message: {
        content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "rg -n large-output web" } }],
      },
    });
    sessions.get("child").messageHistory.push({
      type: "tool_result_preview",
      previews: [
        {
          tool_use_id: "bash-1",
          content: "Found 12",
          is_error: false,
          total_size: 5000,
          is_truncated: true,
        },
      ],
    });
    const traceResponse = await app.request(
      "/sessions/parent/delegates/trace?delegateId=" + encodeURIComponent(delegateId),
    );
    const traceJson = (await traceResponse.json()) as {
      delegateId: string;
      childSessionNum: number | null;
      rawOutputLink: { kind: string; label: string };
      trace: Array<{ label: string; text?: string; status?: string; isTruncated?: boolean; totalSize?: number }>;
    };
    expect(traceResponse.status).toBe(200);
    expect(traceJson.delegateId).toBe(delegateId);
    expect(traceJson.childSessionNum).toBeNull();
    expect(traceJson.rawOutputLink).toMatchObject({ kind: "delegate", label: delegateId });
    expect(traceJson.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Bash", text: "rg -n large-output web", status: "running" }),
        expect.objectContaining({
          label: "Bash result",
          text: "Found 12",
          status: "completed",
          isTruncated: true,
          totalSize: 5000,
        }),
      ]),
    );
  });

  it("fails closed instead of prompting the child before end_delegation is available", async () => {
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      getThreadId: () => "forked-thread",
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
      setArchived: vi.fn(),
      kill: vi.fn(async () => true),
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

    const res = await app.request("/sessions/parent/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: "Read the first three lines of sample.txt and summarize them." }),
      headers: { "content-type": "application/json" },
    });
    const json = (await res.json()) as { error: string; delegateId: string; childSessionId: string };
    expect(res.status).toBe(504);
    expect(json.error).toContain("end_delegation tool did not become available");
    expect(json.delegateId).toEqual(expect.stringMatching(/^del_/));
    expect(json.childSessionId).toBe("child");
    expect(childAdapter.waitForMcpToolAvailability).toHaveBeenCalledWith("takode_delegate", "end_delegation", 10_000);
    expect(childAdapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(launcher.setArchived).toHaveBeenCalledWith("child", true);
    expect(launcher.kill).toHaveBeenCalledWith("child");
    expect(wsBridge.persistSessionById).toHaveBeenCalledWith("child");
  });

  it("fails closed before prompting when the child resumes a different Codex thread", async () => {
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      getThreadId: () => "fresh-thread",
      waitForMcpToolAvailability: vi.fn(async () => true),
      sendBrowserMessage: vi.fn(),
    };
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({ session_id: "parent", backend_type: "codex", cwd: "/repo", model: "gpt-5.5" }),
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
      setArchived: vi.fn(),
      kill: vi.fn(async () => true),
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

    const res = await app.request("/sessions/parent/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: "Answer from inherited fork context only." }),
      headers: { "content-type": "application/json" },
    });
    const json = (await res.json()) as { error: string; expectedThreadId: string; actualThreadId: string };

    expect(res.status).toBe(504);
    expect(json.error).toContain("expected forked Codex thread");
    expect(json.expectedThreadId).toBe("forked-thread");
    expect(json.actualThreadId).toBe("fresh-thread");
    expect(childAdapter.waitForMcpToolAvailability).not.toHaveBeenCalled();
    expect(childAdapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(launcher.setArchived).toHaveBeenCalledWith("child", true);
    expect(launcher.kill).toHaveBeenCalledWith("child");
  });

  it("returns pending delegate trace status with latest live child activity", async () => {
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      getThreadId: () => "forked-thread",
      waitForMcpToolAvailability: vi.fn(async () => true),
      sendBrowserMessage: vi.fn(() => true),
    };
    const sessions = new Map<string, any>();
    sessions.set("parent", {
      id: "parent",
      state: makeState({ session_id: "parent", backend_type: "codex", isOrchestrator: true }),
      codexAdapter: parentAdapter,
    });
    sessions.set("child", {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: childAdapter,
      isGenerating: true,
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
      listSessions: vi.fn(() => [
        { sessionId: "parent", createdAt: 1, sessionNum: 2220 },
        { sessionId: "child", createdAt: 2, hidden: true, publicSessionNumber: false },
      ]),
      getSessionNum: vi.fn(() => undefined),
      setArchived: vi.fn(),
      kill: vi.fn(async () => true),
    };
    const app = new Hono();
    registerSessionDelegateRoutes(app, {
      launcher: launcher as any,
      wsBridge: {
        getSession: vi.fn((id: string) => sessions.get(id)),
        getOrCreateSession: vi.fn((id: string) => sessions.get(id)),
        persistSessionById: vi.fn(),
      } as any,
      resolveId: (id) => id,
      authenticateTakodeCaller: (c) => ({ callerId: c.req.path.includes("/child/") ? "child" : "parent" }),
    });

    const parentRequest = app.request("/sessions/parent/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: "Fork-memory probe. Do not use tools." }),
      headers: { "content-type": "application/json" },
    });
    await vi.waitFor(() => expect(childAdapter.sendBrowserMessage).toHaveBeenCalled());
    const delegateId = (sessions.get("child").state as any).delegateChild.delegateId;
    sessions.get("child").delegateLiveActivity = {
      kind: "assistant",
      label: "Assistant",
      text: "I cannot know the exact fork-memory sentinel. I used no tools.",
      status: "running",
      timestamp: 123,
    };

    const response = await app.request("/sessions/parent/delegates/trace?delegateId=" + encodeURIComponent(delegateId));
    const json = (await response.json()) as {
      pending: boolean;
      childStatus: string;
      trace: Array<{ label: string; text?: string; status?: string }>;
      rawOutputLink: { kind: string; label: string; sessionId: string };
    };

    expect(response.status).toBe(200);
    expect(json.pending).toBe(true);
    expect(json.childStatus).toBe("running");
    expect(json.rawOutputLink).toMatchObject({ kind: "delegate", label: delegateId, sessionId: "child" });
    expect(json.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Assistant",
          text: "I cannot know the exact fork-memory sentinel. I used no tools.",
          status: "running",
        }),
      ]),
    );
    await app.request("/sessions/child/delegates/end", {
      method: "POST",
      body: JSON.stringify({ delegateId, summary: "Delivered after live activity." }),
      headers: { "content-type": "application/json" },
    });
    await parentRequest;
  });

  it("does not resolve early when the child emits interim text before end_delegation", async () => {
    vi.useFakeTimers();
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: {
        isConnected: () => true,
        getThreadId: () => "forked-thread",
        waitForMcpToolAvailability: vi.fn(async () => true),
        sendBrowserMessage: vi.fn(() => {
          childSession.isGenerating = false;
          childSession.messageHistory.push({
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Working on the delegated task now, then I’ll report back." }],
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
      setArchived: vi.fn(),
      kill: vi.fn(async () => true),
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

    const parentRequest = app.request("/sessions/parent/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: "Run a small check and summarize whether it prints ok." }),
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
    expect(parentJson.text).toContain("Delegate task completed.");
    expect(parentJson.text).toContain("The command completed after interim text.");
    expect(launcher.setArchived).toHaveBeenCalledWith("child", true);
    expect(launcher.kill).toHaveBeenCalledWith("child");
  });

  it("returns a bounded parent-visible timeout when the child never calls end_delegation", async () => {
    vi.useFakeTimers();
    const childSession = {
      id: "child",
      state: makeState({ session_id: "child", backend_type: "codex" }),
      codexAdapter: {
        isConnected: () => true,
        getThreadId: () => "forked-thread",
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
      setArchived: vi.fn(),
      kill: vi.fn(async () => true),
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

    const parentRequest = app.request("/sessions/parent/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: "Run a small check and summarize whether it prints ok." }),
      headers: { "content-type": "application/json" },
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const parentResponse = await parentRequest;
    const parentJson = (await parentResponse.json()) as { text: string; isError: boolean };
    expect(parentResponse.status).toBe(200);
    expect(parentJson.isError).toBe(true);
    expect(parentJson.text).toContain("Delegate task failed.");
    expect(parentJson.text).toContain("timed out before calling end_delegation");
    expect(launcher.setArchived).toHaveBeenCalledWith("child", true);
    expect(launcher.kill).toHaveBeenCalledWith("child");
  });

  it("rejects nested delegate_task calls from hidden delegate children even when the tool is visible", async () => {
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

    const response = await app.request("/sessions/child/delegates/task", {
      method: "POST",
      body: JSON.stringify({ task: "Do nested work." }),
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
