import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeMcpManager, type ClaudeMcpQuery } from "./claude-mcp-manager.js";
import type { BrowserIncomingMessage } from "./session-types.js";

const AUTH_URL = "https://auth.example/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A60486%2Fcallback&state=s";

function makeManager(status: unknown[] = [], withSignIn = true) {
  const query = {
    mcpServerStatus: vi.fn(async () => status),
    reconnectMcpServer: vi.fn(async () => {}),
    toggleMcpServer: vi.fn(async () => {}),
    ...(withSignIn
      ? {
          mcpAuthenticate: vi.fn(
            async (): Promise<{ authUrl?: string; requiresUserAction?: boolean }> => ({
              authUrl: AUTH_URL,
              requiresUserAction: true,
            }),
          ),
          mcpSubmitOAuthCallbackUrl: vi.fn(async () => undefined),
        }
      : {}),
  };
  const messages: BrowserIncomingMessage[] = [];
  const manager = new ClaudeMcpManager(
    () => query as unknown as ClaudeMcpQuery,
    (msg) => messages.push(msg),
    "claude-mcp",
  );
  const lastServers = () =>
    (messages.filter((m) => m.type === "mcp_status").at(-1) as unknown as { servers: Array<Record<string, any>> })
      .servers;
  return { query, messages, manager, lastServers };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ClaudeMcpManager status", () => {
  // Claude Code's states map onto the panel's, so a server waiting for a sign-in
  // offers one instead of showing "Unknown", and plugin servers say so.
  it("maps Claude's live status, tools and plugin source", async () => {
    const { manager, lastServers } = makeManager([
      {
        name: "docs",
        status: "connected",
        scope: "user",
        config: { type: "http", url: "https://d.example/mcp" },
        tools: [{ name: "q" }],
      },
      { name: "plugin:n:n", status: "needs-auth", scope: "dynamic", source: "plugin" },
      { name: "slow", status: "pending", scope: "project" },
      { name: "off", status: "disabled", scope: "local" },
    ]);

    await manager.handleGetStatus();

    expect(lastServers()).toEqual([
      expect.objectContaining({
        name: "docs",
        status: "connected",
        scope: "user",
        tools: [{ name: "q", annotations: undefined }],
        config: { type: "http", url: "https://d.example/mcp" },
      }),
      expect.objectContaining({
        name: "plugin:n:n",
        status: "failed",
        needsSignIn: true,
        error: "Needs sign-in",
        scope: "plugin",
      }),
      expect.objectContaining({ name: "slow", status: "connecting", scope: "project" }),
      expect.objectContaining({ name: "off", status: "disabled", scope: "local" }),
    ]);
  });

  it("shows the startup list until the SDK can answer", async () => {
    const messages: BrowserIncomingMessage[] = [];
    const manager = new ClaudeMcpManager(
      () => null,
      (msg) => messages.push(msg),
      "s",
    );
    manager.seed([{ name: "docs", status: "needs-auth" }]);
    expect(await manager.handleGetStatus()).toEqual([expect.objectContaining({ name: "docs", needsSignIn: true })]);
  });

  it("toggles and reconnects through the SDK, then refreshes status", async () => {
    const { query, manager } = makeManager();
    await manager.handleToggle("docs", false);
    await manager.handleReconnect("docs");
    expect(query.toggleMcpServer).toHaveBeenCalledWith("docs", false);
    expect(query.reconnectMcpServer).toHaveBeenCalledWith("docs");
    expect(query.mcpServerStatus).toHaveBeenCalledTimes(2);
  });
});

describe("ClaudeMcpManager sign-in", () => {
  // A desktop browser reaches Claude Code's own loopback callback and the server
  // connects by itself; the pending sign-in notices that by polling status.
  it("shows the link and ends the sign-in once the server connects", async () => {
    vi.useFakeTimers();
    const status: Array<Record<string, unknown>> = [{ name: "docs", status: "needs-auth" }];
    const { query, manager, lastServers } = makeManager(status);
    await manager.handleGetStatus();

    await manager.handleSignIn("docs");
    expect(query.mcpAuthenticate).toHaveBeenCalledWith("docs");
    expect(lastServers()[0].signIn).toEqual({ state: "pending", authorizationUrl: AUTH_URL });

    status[0] = { name: "docs", status: "connected", tools: [{ name: "q" }] };
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lastServers()[0]).toMatchObject({ status: "connected", tools: [{ name: "q" }] });
    expect(lastServers()[0].signIn).toBeUndefined();

    const polls = query.mcpServerStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(query.mcpServerStatus.mock.calls.length).toBe(polls);
  });

  // A phone pastes the address the sign-in ended on; Claude Code stores the
  // token but the server only connects after a reconnect.
  it("submits a matching pasted address, then reconnects the server", async () => {
    const status: Array<Record<string, unknown>> = [{ name: "docs", status: "needs-auth" }];
    const { query, manager, messages, lastServers } = makeManager(status);
    await manager.handleGetStatus();
    await manager.handleSignIn("docs");

    await manager.handleSignInCallback("docs", "http://localhost:9999/callback?code=c");
    expect(messages.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("different sign-in") });
    expect(query.mcpSubmitOAuthCallbackUrl).not.toHaveBeenCalled();

    query.reconnectMcpServer.mockImplementationOnce(async () => {
      status[0] = { name: "docs", status: "connected" };
    });
    await manager.handleSignInCallback("docs", " http://localhost:60486/callback?code=c&state=s ");
    expect(query.mcpSubmitOAuthCallbackUrl).toHaveBeenCalledWith(
      "docs",
      "http://localhost:60486/callback?code=c&state=s",
    );
    expect(query.reconnectMcpServer).toHaveBeenCalledWith("docs");
    expect(lastServers()[0]).toMatchObject({ status: "connected" });
    expect(lastServers()[0].signIn).toBeUndefined();
    manager.dispose();
  });

  it("reports a failed pasted sign-in on the server", async () => {
    const { query, manager, lastServers } = makeManager([{ name: "docs", status: "needs-auth" }]);
    await manager.handleSignIn("docs");
    query.mcpSubmitOAuthCallbackUrl!.mockRejectedValueOnce(new Error("invalid_grant"));

    await manager.handleSignInCallback("docs", "http://localhost:60486/callback?code=c");

    expect(lastServers()[0].signIn).toEqual({ state: "failed", error: "Sign-in failed: invalid_grant" });
    manager.dispose();
  });

  // The sign-in calls are missing from the SDK's published types; without them
  // Takode explains the terminal fallback instead of failing silently.
  it("explains the terminal fallback when the SDK lacks the sign-in calls", async () => {
    const { manager, messages } = makeManager([{ name: "docs", status: "needs-auth" }], false);
    await manager.handleSignIn("docs");
    expect(messages.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("/mcp") });
  });

  it("connects without a link when no sign-in is needed", async () => {
    const { query, manager } = makeManager([{ name: "docs", status: "connected" }]);
    query.mcpAuthenticate!.mockResolvedValueOnce({ requiresUserAction: false });
    await manager.handleSignIn("docs");
    expect(query.reconnectMcpServer).toHaveBeenCalledWith("docs");
  });
});
