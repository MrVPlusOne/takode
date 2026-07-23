import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
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
  it("forks a Codex leader into a hidden child and returns compact summary plus session link", async () => {
    const sentToChild: unknown[] = [];
    const parentAdapter = {
      isConnected: () => true,
      forkThread: vi.fn(async () => "forked-thread"),
    };
    const childAdapter = {
      isConnected: () => true,
      sendBrowserMessage: vi.fn((msg: unknown) => {
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
              codexSandbox: "workspace-write",
              codexInternetAccess: true,
              codexReasoningEffort: "high",
              codexServiceTier: null,
              isOrchestrator: true,
            }
          : id === "child"
            ? { sessionId: "child", backendType: "codex", cwd: "/repo", model: "gpt-5.5", hidden: true }
            : null,
      ),
      launch: vi.fn(async (options: Record<string, unknown>) => {
        expect(options).toMatchObject({
          backendType: "codex",
          resumeCliSessionId: "forked-thread",
          hidden: true,
          parentSessionId: "parent",
          env: {
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
    expect(childPrompt.content).toContain("forked command-delegate copy");
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
});
