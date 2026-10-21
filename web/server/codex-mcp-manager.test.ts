import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexMcpManager } from "./codex-mcp-manager.js";
import type { JsonRpcTransport } from "./codex-jsonrpc-transport.js";
import type { BrowserIncomingMessage } from "./session-types.js";

function makeManager() {
  const call = vi.fn<JsonRpcTransport["call"]>();
  const messages: BrowserIncomingMessage[] = [];
  const manager = new CodexMcpManager(
    { call } as unknown as JsonRpcTransport,
    (message) => messages.push(message),
    "mcp-status-session",
  );
  return { call, messages, manager };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Codex MCP status retrieval", () => {
  it.each([
    "mcpServerStatus/list",
    "config/read",
  ])("records a scoped diagnostic when %s fails without emitting a conversation error", async (failingMethod) => {
    // Both reads belong to one status refresh; a failure in either must remain
    // inspectable without being mistaken for a failed user turn or MCP mutation.
    const { call, messages, manager } = makeManager();
    const diagnostic = "RPC timeout: mcpServerStatus/list\nconnector diagnostic details";
    call.mockImplementation(async (method) => {
      if (method === failingMethod) throw new Error(diagnostic);
      return { data: [] };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await manager.handleGetStatus(750)).toEqual([]);

    const message = `Failed to get MCP status: Error: ${diagnostic}`;
    expect(messages).toEqual([{ type: "session_update", session: { mcp_status_error: message } }]);
    expect(warn).toHaveBeenCalledWith(`[codex-adapter] ${message} for session mcp-status-session`);
    expect(call.mock.calls.map(([method]) => method)).toEqual(
      failingMethod === "config/read" ? ["mcpServerStatus/list", "config/read"] : ["mcpServerStatus/list"],
    );
    expect(call.mock.calls.every(([, , timeout]) => timeout === 750)).toBe(true);
  });

  it.each([
    { label: "an initial empty list", failedFirst: false, data: [] },
    { label: "an empty recovery", failedFirst: true, data: [] },
    { label: "a populated recovery", failedFirst: true, data: [{ name: "docs", tools: { read: { name: "read" } } }] },
  ])("publishes status and explicitly clears the diagnostic for $label", async ({ failedFirst, data }) => {
    // Empty success is authoritative too, including after adapter recreation or
    // a previous refresh failure. It must clear the browser's remembered warning.
    const { call, messages, manager } = makeManager();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failedFirst) {
      call.mockRejectedValueOnce(new Error("RPC timeout"));
      await manager.handleGetStatus();
      expect(messages[0]).toMatchObject({
        type: "session_update",
        session: { mcp_status_error: "Failed to get MCP status: Error: RPC timeout" },
      });
      messages.length = 0;
    }
    call.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ config: {} });

    const servers = await manager.handleGetStatus();

    expect(servers.map((server) => server.name)).toEqual(data.map((server) => server.name));
    expect(messages).toEqual([
      { type: "mcp_status", servers },
      { type: "session_update", session: { mcp_status_error: null } },
    ]);
  });

  it("preserves startup server failures independently of status retrieval failure and recovery", async () => {
    // A startup event cannot prove that the whole status request recovered, and
    // a successful request cannot prove that a failed server itself recovered.
    const { call, messages, manager } = makeManager();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    call.mockRejectedValueOnce(new Error("RPC timeout"));
    await manager.handleGetStatus();
    messages.length = 0;

    const startupError = 'Auth(TokenRefreshFailed("invalid_grant"))';
    manager.handleStartupStatusUpdated({ name: "docs", status: "failed", error: startupError });

    expect(messages).toEqual([
      {
        type: "mcp_status",
        servers: [
          {
            name: "docs",
            status: "failed",
            error: startupError,
            config: { type: "unknown" },
            scope: "session",
            tools: [],
          },
        ],
      },
      { type: "session_update", session: { mcp_servers: [{ name: "docs", status: "failed" }] } },
    ]);
    messages.length = 0;
    call.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ config: {} });

    const servers = await manager.handleGetStatus();

    expect(servers).toEqual([expect.objectContaining({ name: "docs", status: "failed", error: startupError })]);
    expect(messages).toEqual([
      { type: "mcp_status", servers },
      { type: "session_update", session: { mcp_status_error: null } },
    ]);
  });
});

describe("Codex MCP action failures", () => {
  it.each([
    { action: "toggle", method: "config/value/write", prefix: 'Failed to toggle MCP server "docs"' },
    { action: "reload", method: "config/mcpServer/reload", prefix: "Failed to reload MCP servers" },
    { action: "configure", method: "config/batchWrite", prefix: "Failed to configure MCP servers" },
  ] as const)("keeps $action failures on the existing generic error path", async ({ action, method, prefix }) => {
    // Only status retrieval is scoped by this change; actual requested mutations
    // must retain their existing error reporting and must not claim recovery.
    const { call, messages, manager } = makeManager();
    call.mockRejectedValueOnce(new Error("operation failed"));

    if (action === "toggle") await manager.handleToggle("docs", false);
    if (action === "reload") await manager.handleReconnect();
    if (action === "configure") await manager.handleSetServers({ docs: { type: "stdio", command: "docs-server" } });

    expect(call.mock.calls.map(([calledMethod]) => calledMethod)).toEqual([method]);
    expect(messages).toEqual([{ type: "error", message: `${prefix}: Error: operation failed` }]);
  });
});

describe("Codex MCP sign-in", () => {
  const AUTHORIZATION_URL =
    "https://auth.example/authorize?client_id=c&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2Fcallback%2Fabc";

  function makeSignInManager(deliver = vi.fn(async (_url: string) => 200)) {
    const call = vi.fn<JsonRpcTransport["call"]>();
    const messages: BrowserIncomingMessage[] = [];
    const manager = new CodexMcpManager(
      { call } as unknown as JsonRpcTransport,
      (message) => messages.push(message),
      "mcp-sign-in-session",
      { threadId: () => "thread-1", deliverOAuthCallback: deliver },
    );
    return { call, messages, manager, deliver };
  }

  const lastServers = (messages: BrowserIncomingMessage[]) =>
    (
      messages.filter((message) => message.type === "mcp_status").at(-1) as unknown as {
        servers: Array<Record<string, unknown>>;
      }
    ).servers;

  // Plugin servers exist only in a thread's configuration, so both the status
  // list and the sign-in must name the session's thread, or Codex answers
  // "No MCP server named ... found".
  it("lists status for the session's thread and marks a plugin server that needs a sign-in", async () => {
    const { call, messages, manager } = makeSignInManager();
    call.mockImplementation(async (method) =>
      method === "mcpServerStatus/list"
        ? {
            data: [
              {
                name: "neptune",
                authStatus: "notLoggedIn",
                pluginId: "neptune@market",
                httpOrigin: "https://n.example",
              },
            ],
          }
        : { config: {} },
    );

    await manager.handleGetStatus();

    expect(call).toHaveBeenCalledWith(
      "mcpServerStatus/list",
      expect.objectContaining({ threadId: "thread-1" }),
      undefined,
    );
    expect(lastServers(messages)).toEqual([
      expect.objectContaining({
        name: "neptune",
        needsSignIn: true,
        error: "Needs sign-in",
        scope: "plugin neptune@market",
        config: { type: "http", url: "https://n.example" },
      }),
    ]);
  });

  it("starts the thread's sign-in, shows the link, and refreshes the server's tools when Codex reports success", async () => {
    const { call, messages, manager } = makeSignInManager();
    let loggedIn = false;
    call.mockImplementation(async (method) => {
      if (method === "mcpServer/oauth/login") return { authorizationUrl: AUTHORIZATION_URL, loginId: "login-1" };
      if (method === "mcpServerStatus/list")
        return {
          data: [{ name: "neptune", authStatus: loggedIn ? "oAuth" : "notLoggedIn", tools: loggedIn ? { q: {} } : {} }],
        };
      return method === "config/read" ? { config: {} } : {};
    });
    await manager.handleGetStatus();

    await manager.handleSignIn("neptune");
    expect(call).toHaveBeenCalledWith("mcpServer/oauth/login", { name: "neptune", threadId: "thread-1" });
    expect(lastServers(messages)[0]).toMatchObject({
      signIn: { state: "pending", authorizationUrl: AUTHORIZATION_URL },
    });

    // A late result of an earlier attempt is ignored.
    await manager.handleSignInCompleted({ name: "neptune", loginId: "old", success: false, error: "expired" });
    expect(lastServers(messages)[0]).toMatchObject({ signIn: { state: "pending" } });

    loggedIn = true;
    await manager.handleSignInCompleted({ name: "neptune", loginId: "login-1", success: true });
    expect(call).toHaveBeenCalledWith("config/mcpServer/reload", {}, undefined);
    const [server] = lastServers(messages);
    expect(server.signIn).toBeUndefined();
    expect(server.needsSignIn).toBeUndefined();
    expect(server.tools).toEqual([{ name: "q", annotations: undefined }]);
  });

  it("shows why a sign-in could not start or did not complete", async () => {
    const { call, messages, manager } = makeSignInManager();
    call.mockRejectedValueOnce(new Error("No MCP server named 'neptune' found."));

    await manager.handleSignIn("neptune");
    // The status list has not run yet, so only servers known by now are shown.
    expect(messages.at(-1)).toEqual({ type: "mcp_status", servers: [] });

    call.mockResolvedValueOnce({ authorizationUrl: AUTHORIZATION_URL, loginId: "login-2" });
    await manager.handleSignIn("neptune");
    await manager.handleSignInCompleted({
      name: "neptune",
      loginId: "login-2",
      success: false,
      error: "access_denied",
    });
    manager.handleStartupStatusUpdated({ name: "neptune", status: "failed" });
    expect(lastServers(messages)[0]).toMatchObject({
      signIn: { state: "failed", error: "Sign-in failed: access_denied" },
    });
  });

  // A browser on a phone cannot open the provider's redirect to the session's
  // loopback callback; Takode opens the pasted address on the session's machine,
  // but only an address matching the pending sign-in's registered callback.
  it("delivers only a pasted callback that matches the pending sign-in", async () => {
    const { call, messages, manager, deliver } = makeSignInManager();
    call.mockResolvedValueOnce({ authorizationUrl: AUTHORIZATION_URL, loginId: "login-3" });

    await manager.handleSignInCallback("neptune", "http://127.0.0.1:41234/callback/abc?code=x");
    expect(messages.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("No sign-in") });

    await manager.handleSignIn("neptune");
    for (const wrong of [
      "https://evil.example/callback/abc?code=x",
      "http://127.0.0.1:41235/callback/abc?code=x",
      "http://127.0.0.1:41234/callback/abc",
    ]) {
      await manager.handleSignInCallback("neptune", wrong);
      expect(messages.at(-1)).toMatchObject({ type: "error" });
    }
    expect(deliver).not.toHaveBeenCalled();

    await manager.handleSignInCallback("neptune", " http://127.0.0.1:41234/callback/abc?code=x&state=s ");
    expect(deliver).toHaveBeenCalledWith("http://127.0.0.1:41234/callback/abc?code=x&state=s");
  });
});
